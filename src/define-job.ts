import type { JobHandler, JobOptions } from "./types";

// ─── Job definition ───────────────────────────────────────────────────────────
// A job is declared once, in the consumer's code, and carries everything the
// library needs: a unique name, a schema that both types and validates the
// payload, and the handler that runs it. Pass the definitions to
// createQueueClient — the library is never edited to add a job.

/**
 * Structural schema type. Anything with a `parse(unknown): T` satisfies it —
 * every Zod v3/v4 schema does, and so does any Standard-Schema-style validator.
 * The payload type `T` is inferred from `parse`'s return type, so the library
 * carries no dependency on a specific Zod version.
 */
export interface PayloadSchema<Out = unknown> {
  parse(data: unknown): Out;
}

export type InferPayload<S> = S extends PayloadSchema<infer T> ? T : never;

export interface JobDefinition<
  Name extends string = string,
  Schema extends PayloadSchema = PayloadSchema,
> {
  /** Globally unique job name. Also the BullMQ queue name. */
  name: Name;
  /** Validator + type source for the payload (e.g. a Zod schema). */
  schema: Schema;
  /** Runs when a worker processes this job. `ctx.data` is fully typed. */
  handler: JobHandler<InferPayload<Schema>>;
  /** Per-job defaults; overridden per-enqueue and fall back to client defaults. */
  options?: JobOptions;
}

/**
 * Declare a job. Identity function that pins the `name` literal and infers the
 * payload type from `schema`, so `handler`'s `ctx.data` needs no annotation.
 *
 * ```ts
 * const sendEmail = defineJob({
 *   name: "email.send",
 *   schema: z.object({ to: z.string().email(), subject: z.string() }),
 *   handler: async ({ data }) => { await mailer.send(data); },
 * });
 * ```
 */
export function defineJob<Name extends string, Schema extends PayloadSchema>(
  def: JobDefinition<Name, Schema>,
): JobDefinition<Name, Schema> {
  return def;
}

/** Maps a tuple of job definitions to `{ [name]: payload }` for the client. */
export type PayloadMap<Jobs extends readonly JobDefinition[]> = {
  [J in Jobs[number] as J["name"]]: InferPayload<J["schema"]>;
};
