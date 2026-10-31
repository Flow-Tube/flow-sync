import type { Context, MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { z } from "zod";
import type { AppEnv } from "../env.ts";
import { errorResponse, HttpError } from "./errors.ts";

export function limitBody(maxSize: number): MiddlewareHandler<AppEnv> {
  return bodyLimit({
    maxSize,
    onError: (c) => {
      c.set("errorCode", "too_large");
      return errorResponse(c, new HttpError("too_large"));
    },
  });
}

function requireType(c: Context, type: string): void {
  if (c.req.header("content-type")?.split(";")[0]?.trim() !== type)
    throw new HttpError("unsupported");
}

export async function readJson<T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T>> {
  requireType(c, "application/json");
  let value: unknown;
  try {
    value = await c.req.json();
  } catch {
    throw new HttpError("invalid");
  }
  return schema.parse(value);
}

export async function readBytes(c: Context): Promise<Uint8Array<ArrayBuffer>> {
  requireType(c, "application/octet-stream");
  return new Uint8Array(await c.req.arrayBuffer());
}

export function bearer(c: Context): string | undefined {
  const header = c.req.header("authorization");
  return header?.startsWith("Bearer ") ? header.slice(7) : undefined;
}

/** Stored bytes are only ever served as an attachment, never as content a client renders. */
export function octets(c: Context, data: Uint8Array): Response {
  return c.body(data.slice(), 200, {
    "content-type": "application/octet-stream",
    "content-disposition": "attachment",
  });
}
