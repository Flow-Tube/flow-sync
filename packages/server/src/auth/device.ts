import type { Context, MiddlewareHandler } from "hono";
import type { AppEnv } from "../env.ts";
import type { Group } from "../group.ts";
import { bearer, liveToken } from "../http/body.ts";
import { HttpError } from "../http/errors.ts";
import type { Guards, RequestToken } from "../limits/guards.ts";
import type { MetaStore } from "../storage/types.ts";
import { readToken, tokenClaims } from "./token.ts";

export interface AuthDeps {
  group: Group;
  meta: MetaStore;
  now: () => number;
  guards: Guards;
}

/** Reads the roster only for a token the server issued, and keeps it for the rest of the request. */
export function requestToken(group: Group, now: () => number) {
  return async (c: Context<AppEnv>): Promise<RequestToken> => {
    const token = bearer(c) ?? liveToken(c);
    const claims = token && tokenClaims((await group.instance()).secret, token);
    if (!claims) return {};
    if (claims.expires <= now()) return { expired: true };
    const state = await group.roster();
    if (!state?.members.has(claims.did)) return {};
    c.set("roster", state);
    return { did: claims.did };
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
    const state = c.get("roster") ?? (await deps.group.claimed());
    const { secret } = await deps.group.instance();
    const token = tokenOf(c);
    const claims = token ? readToken(secret, token, deps.now()) : undefined;
    if (!claims) throw new HttpError("unauthorized");
    const member = state.members.get(claims.did);
    if (!member) throw new HttpError("unauthorized");
    if (member.role === "recovery" && !allowRecovery) throw new HttpError("forbidden");
    if (member.role === "device") await deps.meta.touchDevice(claims.did, deps.now());
    c.set("did", claims.did);
    c.set("tokenExpires", claims.expires);
    await next();
  };
}
