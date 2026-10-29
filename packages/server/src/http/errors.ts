import { FlowSyncError } from "@flow-sync/protocol";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { ZodError } from "zod";

const STATUS = {
  invalid: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  declined: 410,
  too_large: 413,
  unsupported: 415,
  rate_limited: 429,
  internal: 500,
  unclaimed: 503,
  quota: 507,
} as const satisfies Record<string, ContentfulStatusCode>;

export type ErrorCode = keyof typeof STATUS;

export class HttpError extends Error {
  readonly code: ErrorCode;
  readonly extra: Record<string, unknown>;
  readonly retryAfterSeconds: number | undefined;

  constructor(code: ErrorCode, extra: Record<string, unknown> = {}, retryAfterSeconds?: number) {
    super(code);
    this.code = code;
    this.extra = extra;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export function errorCode(error: unknown): ErrorCode {
  if (error instanceof HttpError) return error.code;
  if (error instanceof FlowSyncError || error instanceof ZodError) return "invalid";
  return "internal";
}

/** Error bodies never echo input. */
export function errorResponse(c: Context, error: unknown): Response {
  const code = errorCode(error);
  const extra = error instanceof HttpError ? error.extra : {};
  if (error instanceof HttpError && error.retryAfterSeconds !== undefined) {
    c.header("Retry-After", String(error.retryAfterSeconds));
  }
  return c.json({ error: code, ...extra }, STATUS[code]);
}
