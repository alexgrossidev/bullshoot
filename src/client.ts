import {
  Queue,
  Worker,
  type ConnectionOptions,
  type JobsOptions,
} from "bullmq";
import type { JobDefinition, PayloadMap } from "./define-job";
import { toConnectionOptions } from "./connection";
import { resolveLogger, type Logger } from "./logger";
import type {
  EnqueueOptions,
  JobContext,
  JobOptions,
  RedisConnection,
  RepeatOptions,
  ScheduleOptions,
} from "./types";

// ─── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULTS: Required<
  Pick<JobOptions, "attempts" | "backoff" | "concurrency" | "lockDuration">
> = {
  attempts: 3,
  backoff: { type: "exponential", delay: 5000 },
  concurrency: 1,
  lockDuration: 60_000,
};

// ─── Public client surface ─────────────────────────────────────────────────────

export interface QueueClient<M extends Record<string, unknown>> {
  /** Add a single job. Returns the BullMQ job id. */
  enqueue<K extends keyof M & string>(
    name: K,
    data: M[K],
    opts?: EnqueueOptions,
  ): Promise<string>;

  /** Add many jobs of the same type in one round-trip. */
  bulkEnqueue<K extends keyof M & string>(
    name: K,
    data: M[K][],
    opts?: EnqueueOptions,
  ): Promise<string[]>;

  /** Register a repeatable job (cron or fixed interval). Safe to call on boot. */
  schedule<K extends keyof M & string>(
    name: K,
    data: M[K],
    opts: ScheduleOptions,
  ): Promise<void>;

  /** Remove a previously scheduled repeatable job. */
  unschedule<K extends keyof M & string>(
    name: K,
    opts: RepeatOptions,
  ): Promise<void>;

  /** Enqueue a one-shot job, optionally delayed, deduped by jobId. */
  scheduleOnce<K extends keyof M & string>(
    name: K,
    data: M[K],
    opts?: EnqueueOptions,
  ): Promise<string>;

  /**
   * Spin up a worker per job (or a subset via `only`). Each worker validates the
   * payload against the job's schema before invoking its handler. Call this only
   * in the process that should consume jobs.
   */
  startWorkers(opts?: { only?: (keyof M & string)[] }): void;

  /** The raw BullMQ queue for a job — escape hatch for advanced use. */
  getQueue<K extends keyof M & string>(name: K): Queue;

  /** All queues (created on demand). Used by the dashboard helper. */
  getAllQueues(): Queue[];

  /** Close every queue and worker and release Redis connections. */
  close(): Promise<void>;
}

// ─── Implementation ─────────────────────────────────────────────────────────────

class QueueClientImpl<M extends Record<string, unknown>>
  implements QueueClient<M>
{
  private readonly connection: ConnectionOptions;
  private readonly defs = new Map<string, JobDefinition>();
  private readonly queues = new Map<string, Queue>();
  private readonly workers = new Map<string, Worker>();
  private readonly defaults: JobOptions;
  private readonly logger: Logger;

  constructor(params: {
    redis: RedisConnection;
    jobs: readonly JobDefinition[];
    defaults?: JobOptions;
    logger?: Logger | false;
  }) {
    this.connection = toConnectionOptions(params.redis);
    this.defaults = params.defaults ?? {};
    this.logger = resolveLogger(params.logger);

    for (const def of params.jobs) {
      if (this.defs.has(def.name)) {
        throw new Error(
          `bullshoot: duplicate job name "${def.name}". Job names must be unique.`,
        );
      }
      this.defs.set(def.name, def);
    }
  }

  // ── Produce ──────────────────────────────────────────────────────────────

  async enqueue(name: string, data: unknown, opts?: EnqueueOptions) {
    const job = await this.getOrCreateQueue(name).add(
      name,
      data,
      this.jobsOptions(name, opts),
    );
    this.logger.info({ job: name, id: job.id }, "job enqueued");
    return job.id!;
  }

  async bulkEnqueue(name: string, data: unknown[], opts?: EnqueueOptions) {
    const options = this.jobsOptions(name, opts);
    const jobs = await this.getOrCreateQueue(name).addBulk(
      data.map((d, i) => ({
        name,
        data: d,
        opts: opts?.jobId ? { ...options, jobId: `${opts.jobId}-${i}` } : options,
      })),
    );
    this.logger.info({ job: name, count: jobs.length }, "bulk enqueued");
    return jobs.map((j) => j.id!);
  }

  async scheduleOnce(name: string, data: unknown, opts?: EnqueueOptions) {
    return this.enqueue(name, data, {
      removeOnComplete: true,
      removeOnFail: { count: 100 },
      ...opts,
    });
  }

  async schedule(name: string, data: unknown, opts: ScheduleOptions) {
    const { repeat } = opts;
    if (repeat.every != null && repeat.cron != null) {
      throw new Error(
        `bullshoot: schedule("${name}") got both \`every\` and \`cron\`; use one.`,
      );
    }
    await this.getOrCreateQueue(name).add(name, data, {
      ...this.jobsOptions(name, opts),
      repeat: {
        ...(repeat.every != null ? { every: repeat.every } : {}),
        ...(repeat.cron != null ? { pattern: repeat.cron } : {}),
        ...(repeat.limit != null ? { limit: repeat.limit } : {}),
      },
    });
    this.logger.info(
      { job: name, every: repeat.every, cron: repeat.cron },
      "repeatable scheduled",
    );
  }

  async unschedule(name: string, opts: RepeatOptions) {
    const removed = await this.getOrCreateQueue(name).removeRepeatable(name, {
      ...(opts.every != null ? { every: opts.every } : {}),
      ...(opts.cron != null ? { pattern: opts.cron } : {}),
    });
    this.logger.info({ job: name, removed }, "repeatable removed");
  }

  // ── Consume ──────────────────────────────────────────────────────────────

  startWorkers(opts?: { only?: string[] }) {
    const names = opts?.only ?? [...this.defs.keys()];

    for (const name of names) {
      const def = this.defs.get(name);
      if (!def) {
        throw new Error(
          `bullshoot: startWorkers({ only }) referenced unknown job "${name}".`,
        );
      }
      if (this.workers.has(name)) continue; // idempotent

      const merged = this.mergedOptions(def);
      const worker = new Worker(
        name,
        async (job) => {
          // Process-time validation: bad payloads fail the job and surface in
          // retries / the dashboard rather than silently reaching the handler.
          const data = def.schema.parse(job.data);
          const ctx: JobContext = {
            id: job.id!,
            name: job.name,
            data,
            attemptsMade: job.attemptsMade,
            logger: this.logger,
            raw: job,
          };
          await def.handler(ctx);
        },
        {
          connection: this.connection,
          concurrency: merged.concurrency ?? DEFAULTS.concurrency,
          lockDuration: merged.lockDuration ?? DEFAULTS.lockDuration,
        },
      );

      worker.on("completed", (job) =>
        this.logger.info({ job: name, id: job.id }, "job completed"),
      );
      worker.on("failed", (job, err) =>
        this.logger.error(
          { job: name, id: job?.id, err: err.message },
          "job failed",
        ),
      );
      worker.on("error", (err) =>
        this.logger.error({ job: name, err }, "worker error"),
      );

      this.workers.set(name, worker);
      this.logger.info(
        { job: name, concurrency: merged.concurrency ?? DEFAULTS.concurrency },
        "worker started",
      );
    }
  }

  // ── Access ───────────────────────────────────────────────────────────────

  getQueue(name: string): Queue {
    return this.getOrCreateQueue(name);
  }

  getAllQueues(): Queue[] {
    for (const name of this.defs.keys()) this.getOrCreateQueue(name);
    return [...this.queues.values()];
  }

  async close(): Promise<void> {
    await Promise.all([
      ...[...this.workers.values()].map((w) => w.close()),
      ...[...this.queues.values()].map((q) => q.close()),
    ]);
    this.workers.clear();
    this.queues.clear();
    this.logger.info({}, "client closed");
  }

  // ── Internal ─────────────────────────────────────────────────────────────

  private getOrCreateQueue(name: string): Queue {
    if (!this.defs.has(name)) {
      throw new Error(
        `bullshoot: no job named "${name}" was registered with this client.`,
      );
    }
    let queue = this.queues.get(name);
    if (!queue) {
      queue = new Queue(name, { connection: this.connection });
      this.queues.set(name, queue);
    }
    return queue;
  }

  /** Merge order: client defaults < per-job options. */
  private mergedOptions(def: JobDefinition): JobOptions {
    return { ...this.defaults, ...def.options };
  }

  /** Build BullMQ per-add options. Merge order: defaults < job < per-enqueue. */
  private jobsOptions(name: string, opts?: EnqueueOptions): JobsOptions {
    const def = this.defs.get(name);
    const merged = { ...this.defaults, ...def?.options };
    return {
      attempts: opts?.attempts ?? merged.attempts ?? DEFAULTS.attempts,
      backoff: opts?.backoff ?? merged.backoff ?? DEFAULTS.backoff,
      ...(opts?.jobId != null ? { jobId: opts.jobId } : {}),
      ...(opts?.delay != null ? { delay: opts.delay } : {}),
      ...(opts?.priority != null ? { priority: opts.priority } : {}),
      ...pickKeep("removeOnComplete", opts, merged),
      ...pickKeep("removeOnFail", opts, merged),
    };
  }
}

function pickKeep(
  key: "removeOnComplete" | "removeOnFail",
  opts: EnqueueOptions | undefined,
  merged: JobOptions,
): JobsOptions {
  const value = opts?.[key] ?? merged[key];
  return value != null ? ({ [key]: value } as JobsOptions) : {};
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export interface CreateQueueClientConfig<
  Jobs extends readonly JobDefinition[],
> {
  /** Redis connection — explicit config, no env magic. */
  redis: RedisConnection;
  /** Every job this client can enqueue or process. */
  jobs: Jobs;
  /** Defaults applied to all jobs, overridable per job and per enqueue. */
  defaults?: JobOptions;
  /** Custom logger, or `false` to silence the library. Defaults to console. */
  logger?: Logger | false;
}

/**
 * Create a fully type-safe queue client from a set of job definitions.
 * `enqueue`/`schedule` only accept registered names with correctly typed data;
 * `startWorkers()` runs the matching handlers with schema validation.
 */
export function createQueueClient<const Jobs extends readonly JobDefinition[]>(
  config: CreateQueueClientConfig<Jobs>,
): QueueClient<PayloadMap<Jobs>> {
  return new QueueClientImpl<PayloadMap<Jobs>>(config);
}
