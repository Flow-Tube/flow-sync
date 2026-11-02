import type { Context, MiddlewareHandler } from "hono";
import type { AppEnv } from "../env.ts";
import { HttpError } from "../http/errors.ts";
import { LIMITS } from "../limits.ts";
import { FailureBans, RateLimiter } from "./counters.ts";

const MINUTE = 60_000;

export type ClientIp = (c: Context) => string | undefined;

export interface Guards {
  clientIp: ClientIp;
  now: () => number;
  anonymous: RateLimiter;
  devices: RateLimiter;
  authFailures: FailureBans;
  adminFailures: FailureBans;
}

export function createGuards(clientIp: ClientIp, now: () => number): Guards {
  return {
    clientIp,
    now,
    anonymous: new RateLimiter(LIMITS.ipPerMinute, MINUTE),
    devices: new RateLimiter(LIMITS.devicePerMinute, MINUTE),
    authFailures: new FailureBans(LIMITS.authFailures, LIMITS.banMs),
    adminFailures: new FailureBans(LIMITS.adminFailures, LIMITS.banMs),
  };
}

export function checkBan(bans: FailureBans, key: string, now: number): void {
  const wait = bans.bannedFor(key, now);
  if (wait) throw new HttpError("rate_limited", {}, wait);
}

export function checkRate(limiter: RateLimiter, key: string, now: number): void {
  const wait = limiter.take(key, now);
  if (wait) throw new HttpError("rate_limited", {}, wait);
}

/** The device id of a request's token if the server issued it and it hasn't expired. */
export type TokenDevice = (c: Context) => Promise<string | undefined>;

/**
 * Requests without a valid device token count against their IP address, whatever headers they
 * carry. Any 401 among them counts as a failed authentication, and repeated failures ban the
 * address for a while. A device with a valid token is limited per device instead, so a ban
 * doesn't lock out every device behind a shared address.
 */
export function guardRequests(guards: Guards, tokenDevice: TokenDevice): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (await tokenDevice(c)) return next();
    const ip = guards.clientIp(c) ?? "unknown";
    checkBan(guards.authFailures, ip, guards.now());
    checkRate(guards.anonymous, ip, guards.now());
    await next();
    if (c.res.status === 401) guards.authFailures.fail(ip, guards.now());
  };
}
