import { type Context, Hono } from "hono";
import { z } from "zod";
import { requireAdmin } from "../auth/admin.ts";
import { type AuthDeps, requireMember } from "../auth/device.ts";
import type { Config } from "../config.ts";
import type { AppEnv } from "../env.ts";
import { limitBody, readJson } from "../http/body.ts";
import { HttpError } from "../http/errors.ts";
import type { Guards } from "../limits/guards.ts";
import { LIMITS } from "../limits.ts";

const ID = ":id{[0-9a-f]{32}}";
const requestSchema = z.strictObject({
  id: z.string().regex(/^[0-9a-f]{32}$/),
  name: z.string().min(1).max(LIMITS.joinName),
});
const answerSchema = z.strictObject({ code: z.string().min(1).max(LIMITS.joinCode) });

/**
 * A new device asks to join with the admin token instead of scanning a code (protocol.md,
 * Joining with the admin token); a member answers with the code it would have shown.
 */
export function joinRoutes(deps: AuthDeps, config: Config, guards: Guards) {
  const { meta, group, now } = deps;
  const member = requireMember(deps);
  const admin = requireAdmin(config, guards);
  const id = (c: Context<AppEnv>) => c.req.param("id") as string;
  /** 404 when the request is unknown or expired, 409 when a member already answered or declined it. */
  const settled = async (c: Context<AppEnv>, done: boolean, status: 201 | 204) => {
    if (done) return c.body(null, status);
    throw new HttpError((await meta.hasJoinRequest(id(c), now())) ? "conflict" : "not_found");
  };

  return new Hono<AppEnv>()
    .post("/v1/join", admin, limitBody(LIMITS.jsonBody), async (c) => {
      await group.claimed();
      const body = await readJson(c, requestSchema);
      const expires = now() + LIMITS.pairMs;
      if (!(await meta.addJoinRequest({ ...body, expires }, LIMITS.joinRequests, now()))) {
        throw new HttpError("conflict");
      }
      return c.json({ expires }, 201);
    })
    .get("/v1/join", member, async (c) => c.json({ requests: await meta.openJoinRequests(now()) }))
    .put(`/v1/join/${ID}`, member, limitBody(LIMITS.jsonBody), async (c) => {
      const { code } = await readJson(c, answerSchema);
      return settled(c, await meta.answerJoinRequest(id(c), code, now()), 201);
    })
    .get(`/v1/join/${ID}`, admin, async (c) => {
      const answer = await meta.joinAnswer(id(c), now());
      if (answer?.declined) throw new HttpError("declined");
      if (answer?.code === undefined) throw new HttpError("not_found");
      return c.json({ code: answer.code });
    })
    .delete(`/v1/join/${ID}`, member, async (c) =>
      settled(c, await meta.declineJoinRequest(id(c), now()), 204),
    );
}
