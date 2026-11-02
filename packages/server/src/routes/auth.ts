import { concat, fromB64, fromHex, randomBytes, tag, toB64, toHex } from "@flow-sync/protocol";
import { Hono } from "hono";
import { z } from "zod";
import type { AuthDeps } from "../auth/device.ts";
import { issueToken } from "../auth/token.ts";
import { verifySignature } from "../crypto.ts";
import type { AppEnv } from "../env.ts";
import { limitBody, readJson } from "../http/body.ts";
import { HttpError } from "../http/errors.ts";
import { LIMITS } from "../limits.ts";

const did = z.string().regex(/^[0-9a-f]{32}$/);
const challengeSchema = z.strictObject({ did });
const tokenSchema = z.strictObject({
  did,
  challenge: z.string().max(64),
  sig: z.string().max(128),
});

function decode(value: string): Uint8Array {
  try {
    return fromB64(value);
  } catch {
    throw new HttpError("unauthorized");
  }
}

export function authRoutes({ group, meta, now }: AuthDeps) {
  // Mounted at "/", so a pathless `.use` would cap every route's body; the limit goes on each route instead.
  return new Hono<AppEnv>()
    .post("/v1/auth/challenge", limitBody(LIMITS.jsonBody), async (c) => {
      const body = await readJson(c, challengeSchema);
      const state = await group.claimed();
      if (!state.members.has(body.did)) throw new HttpError("unauthorized");
      await meta.purgeExpired(now());
      const challenge = randomBytes(32);
      await meta.putChallenge(toHex(challenge), body.did, now() + LIMITS.challengeMs);
      const instance = await group.instance();
      return c.json({
        challenge: toB64(challenge),
        instance: toHex(instance.id),
        group: state.group,
        time: now(),
      });
    })
    .post("/v1/auth/token", limitBody(LIMITS.jsonBody), async (c) => {
      const body = await readJson(c, tokenSchema);
      const state = await group.claimed();
      const instance = await group.instance();
      const challenge = decode(body.challenge);
      const issued = await meta.takeChallenge(toHex(challenge));
      const member = state.members.get(body.did);
      if (!issued || issued.did !== body.did || issued.expires <= now() || !member) {
        throw new HttpError("unauthorized");
      }
      const message = concat(tag("auth"), instance.id, fromHex(state.group), challenge);
      const signature = decode(body.sig);
      if (!(await verifySignature({ key: member.sig, message, signature })))
        throw new HttpError("unauthorized");
      const expires = now() + LIMITS.tokenMs;
      return c.json({ token: issueToken(instance.secret, fromHex(body.did), expires), expires });
    });
}
