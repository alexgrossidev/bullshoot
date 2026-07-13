// ─── Logger ─────────────────────────────────────────────────────────────────
// QuickRedis ships no logging dependency. It logs through this tiny interface,
// which pino, winston, console, or a no-op all satisfy. Pass your own to
// createQueueClient({ logger }), or `false` to silence the library entirely.

export interface Logger {
  debug(obj: unknown, msg?: string): void;
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

/** Structured console logger used when the consumer supplies none. */
export const consoleLogger: Logger = {
  debug: (obj, msg) => console.debug("[bullshoot]", msg ?? "", obj ?? ""),
  info: (obj, msg) => console.info("[bullshoot]", msg ?? "", obj ?? ""),
  warn: (obj, msg) => console.warn("[bullshoot]", msg ?? "", obj ?? ""),
  error: (obj, msg) => console.error("[bullshoot]", msg ?? "", obj ?? ""),
};

/** Discards everything. Selected when the consumer passes `logger: false`. */
export const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

export function resolveLogger(logger: Logger | false | undefined): Logger {
  if (logger === false) return silentLogger;
  return logger ?? consoleLogger;
}
