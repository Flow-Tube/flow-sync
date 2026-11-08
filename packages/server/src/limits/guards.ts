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
    authFailures: new FailureBans(LIMITS.authFailures, LIMITS.banMs, LIMITS.authBackoffFrom),
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

/** What a request's token says for the limits. */
export interface RequestToken {
  /** A current member, by a token that is valid now. */
  did?: string;
  /** The server issued it and it ran out, which is how renewing a token starts, not a failure. */
  expired?: boolean;
}

/**
 * A current member's requests count against that device, on every route. All others count against
 * their IP address, whatever headers they carry. A 401 among them counts as a failed
 * authentication, which makes the address wait and in the end bans it, so a ban doesn't lock out
 * the devices behind a shared address.
 */
export function guardRequests(
  guards: Guards,
  requestToken: (c: Context<AppEnv>) => Promise<RequestToken>,
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const { did, expired } = await requestToken(c);
    if (did) {
      checkRate(guards.devices, did, guards.now());
      return next();
    }
    const ip = guards.clientIp(c) ?? "unknown";
    checkBan(guards.authFailures, ip, guards.now());
    checkRate(guards.anonymous, ip, guards.now());
    await next();
    if (c.res.status === 401 && !expired) guards.authFailures.fail(ip, guards.now());
  };
}
