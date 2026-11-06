import { type Context, Hono } from "hono";
import { z } from "zod";
import { type AuthDeps, requireMember } from "../auth/device.ts";
import type { AppEnv } from "../env.ts";
import { limitBody, octets, readBytes, readJson } from "../http/body.ts";
import { HttpError } from "../http/errors.ts";
import { LIMITS } from "../limits.ts";

const SLOT = ":slot{[0-9a-f]{32}}";
const MESSAGE = `/v1/pair/${SLOT}/:name{[ab]-[0-9a-f]{16}\\.p}`;
const openSchema = z.strictObject({ slot: z.string().regex(/^[0-9a-f]{32}$/) });

/**
 * Knowing the slot id is the capability: only someone who read the QR code can derive it,
 * and a new device has no token yet.
 */
export function pairRoutes(deps: AuthDeps) {
  const { meta, group, now } = deps;
  const member = requireMember(deps);

  async function openSlot(c: Context): Promise<string> {
    await group.claimed();
    const slot = c.req.param("slot") as string;
    const expires = await meta.slotExpiry(slot);
    if (expires === undefined || expires <= now()) throw new HttpError("not_found");
    return slot;
  }

  return new Hono<AppEnv>()
    .post("/v1/pair", limitBody(LIMITS.jsonBody), member, async (c) => {
      const { slot } = await readJson(c, openSchema);
      const expires = now() + LIMITS.pairMs;
      if (!(await meta.openSlot(slot, expires, LIMITS.pairSlots, now()))) {
        throw new HttpError("conflict");
      }
      return c.json({ expires }, 201);
    })
    .put(MESSAGE, limitBody(LIMITS.pairMessage), async (c) => {
      const slot = await openSlot(c);
      const name = c.req.param("name");
      if (Number.parseInt(name.slice(2, 18), 16) >= LIMITS.pairMessages)
        throw new HttpError("invalid");
      const bytes = await readBytes(c);
      if (bytes.length < LIMITS.pairMessageMin) throw new HttpError("invalid");
      const result = await meta.putPairMessage(slot, name, bytes);
      if (result === "conflict") throw new HttpError("conflict");
      return c.body(null, result === "created" ? 201 : 200);
    })
    .get(MESSAGE, async (c) => {
      const data = await meta.getPairMessage(await openSlot(c), c.req.param("name"));
      if (!data) throw new HttpError("not_found");
      return octets(c, data);
    })
    .delete(`/v1/pair/${SLOT}`, member, async (c) => {
      await meta.deleteSlot(c.req.param("slot"));
      return c.body(null, 204);
    });
}
