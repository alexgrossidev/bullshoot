import type { Job } from "bullmq";
import type { Logger } from "./logger";

// ─── Connection ───────────────────────────────────────────────────────────────
// Supply either a full connection URL or discrete fields. No env auto-loading,
// no process.exit — the host app owns configuration.

export interface RedisConnectionParts {
  host: string;
  port?: number;
  username?: string;
  password?: string;
  /** Force TLS. Auto-enabled when a `rediss://` url is used. */
  tls?: boolean;
  /** BullMQ requires this to be null; overridable but rarely needed. */
  maxRetriesPerRequest?: number | null;
}

export interface RedisConnectionUrl {
  /** e.g. `redis://:pass@host:6379` or `rediss://…` for TLS. */
  url: string;
  tls?: boolean;
  maxRetriesPerRequest?: number | null;
}

export type RedisConnection = RedisConnectionParts | RedisConnectionUrl;

// ─── Job options ──────────────────────────────────────────────────────────────

export interface BackoffOptions {
  type: "fixed" | "exponential";
  delay: number;
}

/** Retention policy for finished jobs. */
export type KeepPolicy = boolean | { age?: number; count?: number };

/** Defaults applied to a job at definition time or client-wide. */
export interface JobOptions {
  /** Max attempts before a job is marked failed. Default: 3. */
  attempts?: number;
  /** Retry backoff. Default: exponential, 5s base. */
  backoff?: BackoffOptions;
  /** Parallel jobs a single worker will run. Default: 1. */
  concurrency?: number;
  /** Auto-remove completed jobs. Default: false. */
  removeOnComplete?: KeepPolicy;
  /** Auto-remove failed jobs. Default: false. */
  removeOnFail?: KeepPolicy;
  /** How long (ms) a job may run before it is considered stalled. Default: 60s. */
  lockDuration?: number;
}

/** Per-enqueue overrides. */
export interface EnqueueOptions {
  /** Idempotency key — a second enqueue with the same id is ignored. */
  jobId?: string;
  /** Delay in ms before the job becomes processable. */
  delay?: number;
  /** Lower number = higher priority. */
  priority?: number;
  attempts?: number;
  backoff?: BackoffOptions;
  removeOnComplete?: KeepPolicy;
  removeOnFail?: KeepPolicy;
}

export interface RepeatOptions {
  /** Interval in ms. Mutually exclusive with `cron`. */
  every?: number;
  /** Cron expression. Mutually exclusive with `every`. */
  cron?: string;
  /** Max total executions. Omit for unlimited. */
  limit?: number;
}

export interface ScheduleOptions extends EnqueueOptions {
  repeat: RepeatOptions;
}

// ─── Handler context ────────────────────────────────────────────────────────

export interface JobContext<T = unknown> {
  /** BullMQ job id. */
  id: string;
  /** Job name (matches the definition name). */
  name: string;
  /** The validated payload. */
  data: T;
  /** How many attempts have been made so far (including the current one). */
  attemptsMade: number;
  /** Scoped logger; log lines carry the job name and id. */
  logger: Logger;
  /** Escape hatch to the raw BullMQ job for advanced use. */
  raw: Job<T>;
}

export type JobHandler<T = unknown> = (
  ctx: JobContext<T>,
) => Promise<void> | void;
