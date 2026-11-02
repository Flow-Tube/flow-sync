import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../env.ts";

export type LogLine = Record<string, string | number>;
export type Logger = (line: LogLine) => void;

/** Logs the route pattern, never the path, body, headers or client address. */
export function requestLog(log: Logger, now: () => number): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const start = now();
    await next();
    const line: LogLine = {
      time: new Date(start).toISOString(),
      method: c.req.method,
      route: c.req.routePath,
      status: c.res.status,
      ms: now() - start,
    };
    const size = c.req.header("content-length");
    if (size) line.bytes = Number(size);
    if (c.res.status >= 400) line.error = c.get("errorCode") ?? "unknown";
    const name = c.get("errorName");
    if (name) line.cause = name;
    log(line);
  };
}
