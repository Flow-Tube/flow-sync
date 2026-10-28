import { equalBytes, sha256, utf8 } from "@flow-sync/protocol";
import type { MiddlewareHandler } from "hono";
import type { Config } from "../config.ts";
import type { AppEnv } from "../env.ts";
import { bearer } from "../http/body.ts";
import { HttpError } from "../http/errors.ts";

/** Compares hashes of equal length, so the check takes the same time for any token. */
export function requireAdmin(config: Config): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const token = bearer(c);
    const expected = config.adminTokenHash;
    if (!expected || !token || !equalBytes(sha256(utf8(token)), expected)) {
      throw new HttpError("unauthorized");
    }
    await next();
  };
}
