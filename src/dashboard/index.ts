// ─── Bull Board dashboard (optional subpath) ────────────────────────────────
// Imported as `@alegrossi2001/bullshoot/dashboard`. Bull Board is an optional
// dependency: this module loads it lazily so the core install stays lean and
// consumers who never mount a dashboard pay nothing.

import type { Queue } from "bullmq";
import type { QueueClient } from "../client";

export interface DashboardHandler {
  /** Express-compatible router to mount, e.g. `app.use("/admin/queues", router)`. */
  router: unknown;
  /** The base path the router was configured for. */
  basePath: string;
}

export interface MountDashboardOptions {
  /** Path the dashboard is served under. Default: "/admin/queues". */
  basePath?: string;
  /** Restrict to specific queues. Default: every queue on the client. */
  queues?: Queue[];
}

/**
 * Build a Bull Board Express router for a client's queues.
 *
 * ```ts
 * import express from "express";
 * import { mountDashboard } from "@alegrossi2001/bullshoot/dashboard";
 *
 * const app = express();
 * const { router, basePath } = await mountDashboard(client);
 * app.use(basePath, router);
 * ```
 *
 * Requires `@bull-board/api`, `@bull-board/express`, and `express` to be
 * installed by the consumer. Throws a clear error if they are missing.
 */
export async function mountDashboard(
  client: Pick<QueueClient<Record<string, unknown>>, "getAllQueues">,
  options: MountDashboardOptions = {},
): Promise<DashboardHandler> {
  const basePath = options.basePath ?? "/admin/queues";

  let createBullBoard: typeof import("@bull-board/api").createBullBoard;
  let BullMQAdapter: typeof import("@bull-board/api/bullMQAdapter").BullMQAdapter;
  let ExpressAdapter: typeof import("@bull-board/express").ExpressAdapter;

  try {
    ({ createBullBoard } = await import("@bull-board/api"));
    ({ BullMQAdapter } = await import("@bull-board/api/bullMQAdapter"));
    ({ ExpressAdapter } = await import("@bull-board/express"));
  } catch (err) {
    throw new Error(
      "bullshoot/dashboard requires @bull-board/api, @bull-board/api/bullMQAdapter and @bull-board/express. " +
        "Install them: npm i @bull-board/api @bull-board/express express\n" +
        `Original error: ${(err as Error).message}`,
    );
  }

  const queues = options.queues ?? client.getAllQueues();
  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath(basePath);

  createBullBoard({
    queues: queues.map((q) => new BullMQAdapter(q)),
    serverAdapter,
  });

  return { router: serverAdapter.getRouter(), basePath };
}
