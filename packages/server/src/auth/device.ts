import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../env.ts";
import type { Group } from "../group.ts";
import { bearer } from "../http/body.ts";
import { HttpError } from "../http/errors.ts";
import { checkRate, type Guards, type TokenDevice } from "../limits/guards.ts";
import type { MetaStore } from "../storage/types.ts";
import { readToken } from "./token.ts";

export interface AuthDeps {
  group: Group;
  meta: MetaStore;
  now: () => number;
  guards: Guards;
}

/** Checks only the token's MAC and expiry, which needs no storage read once the secret is loaded. */
export function tokenDevice(group: Group, now: () => number): TokenDevice {
  return async (c) => {
    const token = bearer(c);
    return token && readToken((await group.instance()).secret, token, now())?.did;
  };
}

/**
 * Accepts a token only while its member is in the roster, so removal takes effect at once.
 * The recovery member may use routes that opt in; it needs them to restore the group.
 */
export function requireMember(
  deps: AuthDeps,
  { allowRecovery = false, token: tokenOf = bearer } = {},
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const state = await deps.group.claimed();
    const { secret } = await deps.group.instance();
    const token = tokenOf(c);
    const claims = token ? readToken(secret, token, deps.now()) : undefined;
    if (!claims) throw new HttpError("unauthorized");
    checkRate(deps.guards.devices, claims.did, deps.now());
    const member = state.members.get(claims.did);
    if (!member) throw new HttpError("unauthorized");
    if (member.role === "recovery" && !allowRecovery) throw new HttpError("forbidden");
    if (member.role === "device") await deps.meta.touchDevice(claims.did, deps.now());
    c.set("did", claims.did);
    c.set("tokenExpires", claims.expires);
    await next();
  };
}
