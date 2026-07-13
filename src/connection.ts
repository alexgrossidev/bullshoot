import type { ConnectionOptions } from "bullmq";
import type { RedisConnection } from "./types";

// ─── Connection ───────────────────────────────────────────────────────────────
// Translate the user-supplied config into BullMQ ConnectionOptions. Explicit,
// side-effect free: no dotenv, no filesystem walk, no process.exit.

function hasUrl(
  c: RedisConnection,
): c is Extract<RedisConnection, { url: string }> {
  return "url" in c && typeof c.url === "string";
}

export function toConnectionOptions(config: RedisConnection): ConnectionOptions {
  const maxRetriesPerRequest =
    config.maxRetriesPerRequest !== undefined
      ? config.maxRetriesPerRequest
      : null; // BullMQ requires null unless the user opts out deliberately

  if (hasUrl(config)) {
    const useTls = config.tls ?? config.url.startsWith("rediss://");
    return {
      url: config.url,
      maxRetriesPerRequest,
      ...(useTls ? { tls: {} } : {}),
    };
  }

  return {
    host: config.host,
    port: config.port ?? 6379,
    ...(config.username ? { username: config.username } : {}),
    ...(config.password ? { password: config.password } : {}),
    maxRetriesPerRequest,
    ...(config.tls ? { tls: {} } : {}),
  };
}

/**
 * Convenience for the common "read from process.env" case. Opt-in — the library
 * never calls this for you. Throws (does not exit the process) when required
 * vars are missing.
 *
 * Reads: REDIS_URL, REDIS_HOST, REDIS_PORT, REDIS_USERNAME, REDIS_PASSWORD.
 */
export function connectionFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): RedisConnection {
  if (env.REDIS_URL && env.REDIS_URL.includes("://")) {
    return { url: env.REDIS_URL };
  }

  const host = env.REDIS_URL || env.REDIS_HOST;
  if (!host) {
    throw new Error(
      "bullshoot: connectionFromEnv() found no REDIS_URL or REDIS_HOST in the environment.",
    );
  }

  return {
    host,
    port: env.REDIS_PORT ? Number(env.REDIS_PORT) : 6379,
    username: env.REDIS_USERNAME || undefined,
    password: env.REDIS_PASSWORD || env.REDIS_PWD || undefined,
  };
}
