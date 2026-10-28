import {
  concat,
  fromB64,
  fromHex,
  randomBytes,
  tag,
  toB64,
  toHex,
  verify,
} from "@flow-sync/protocol";
import { Hono } from "hono";
import { z } from "zod";
import type { AuthDeps } from "../auth/device.ts";
import { issueToken } from "../auth/token.ts";
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
  return new Hono<AppEnv>()
    .use(limitBody(LIMITS.jsonBody))
    .post("/v1/auth/challenge", async (c) => {
      const body = await readJson(c, challengeSchema);
      await group.claimed();
      await meta.purgeExpired(now());
      const challenge = randomBytes(32);
      await meta.putChallenge(toHex(challenge), body.did, now() + LIMITS.challengeMs);
      const instance = await group.instance();
      return c.json({ challenge: toB64(challenge), instance: toHex(instance.id), time: now() });
    })
    .post("/v1/auth/token", async (c) => {
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
      if (!verify(member.sig, message, decode(body.sig))) throw new HttpError("unauthorized");
      const expires = now() + LIMITS.tokenMs;
      return c.json({ token: issueToken(instance.secret, fromHex(body.did), expires), expires });
    });
}
