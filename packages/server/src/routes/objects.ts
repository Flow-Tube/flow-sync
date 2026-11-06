import {
  BOX_OVERHEAD,
  checkSender,
  type DevicePath,
  fromHex,
  logPath,
  ObjectType,
  objectSignature,
  parseDevicePath,
  parseObject,
  type RosterState,
  toHex,
} from "@flow-sync/protocol";
import { type Context, Hono } from "hono";
import { z } from "zod";
import { type AuthDeps, requireMember } from "../auth/device.ts";
import type { Config } from "../config.ts";
import { sha256Hex, verifySignature } from "../crypto.ts";
import type { AppEnv } from "../env.ts";
import { limitBody, octets, readBytes } from "../http/body.ts";
import { HttpError } from "../http/errors.ts";
import { LIMITS } from "../limits.ts";
import type { Stored } from "../live/relay.ts";
import type { BlobStore, MetaStore } from "../storage/types.ts";

const PREFIX = "/v1/objects/";

type Stores = { meta: MetaStore; blobs: BlobStore };
const changesSchema = z.object({
  after: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(LIMITS.changesPage).default(LIMITS.changesPage),
});

function devicePath(c: Context): DevicePath & { path: string } {
  const path = c.req.path.slice(PREFIX.length);
  const parsed = parseDevicePath(path);
  if (!parsed) throw new HttpError("not_found");
  return { ...parsed, path };
}

/** The epoch of the sender's object at `seq` - 1, or 0 when the server doesn't hold it. */
async function previousEpoch(
  { meta, blobs }: Stores,
  state: RosterState,
  target: Extract<DevicePath, { kind: "log" }>,
) {
  const record = target.seq > 1 && (await meta.getObject(logPath(target.did, target.seq - 1)));
  const bytes = record && (await blobs.get(record.hash));
  return bytes ? parseObject(bytes, fromHex(state.group)).header.epoch : 0;
}

/** Checks that the bytes are what the path claims, signed by the device that owns it. */
async function checkObject(
  stores: Stores,
  state: RosterState,
  target: DevicePath,
  bytes: Uint8Array,
  hash: string,
) {
  if (target.kind === "blob") {
    if (hash !== target.hash || bytes.length < BOX_OVERHEAD) throw new HttpError("invalid");
    return;
  }
  const object = parseObject(bytes, fromHex(state.group));
  const { header } = object;
  const valid =
    header.type !== ObjectType.live &&
    toHex(header.sender) === target.did &&
    header.seq === target.seq &&
    header.epoch <= state.epoch;
  if (!valid) throw new HttpError("invalid");
  const sender = state.members.get(target.did);
  if (!sender) throw new HttpError("forbidden");
  checkSender(state, target.did, header.epoch, header.seq);
  if (!(await verifySignature(objectSignature(object, sender.sig)))) throw new HttpError("invalid");
  // Sealed before the sender saw the new epoch (spec/api.md, Objects); a device never goes back.
  if (header.epoch < state.epoch && header.epoch < (await previousEpoch(stores, state, target))) {
    throw new HttpError("invalid");
  }
}

export function objectRoutes(
  deps: AuthDeps & { blobs: BlobStore; stored: Stored },
  config: Config,
) {
  const { meta, blobs, group } = deps;
  const member = requireMember(deps);
  return new Hono<AppEnv>()
    .put(`${PREFIX}*`, limitBody(LIMITS.object), member, async (c) => {
      const target = devicePath(c);
      if (target.did !== c.get("did")) throw new HttpError("forbidden");
      const bytes = await readBytes(c);
      const hash = await sha256Hex(bytes);
      const existing = await meta.getObject(target.path);
      if (existing) {
        if (existing.hash !== hash) throw new HttpError("conflict");
        return c.body(null, 200);
      }
      await checkObject(deps, await group.claimed(), target, bytes, hash);
      if ((await meta.usage()).bytes + bytes.length > config.quota) throw new HttpError("quota");
      await blobs.put(hash, bytes);
      const result = await meta.putObject({
        path: target.path,
        did: target.did,
        hash,
        size: bytes.length,
      });
      if (result === "conflict") {
        if (!(await meta.isHashUsed(hash))) await blobs.delete(hash);
        throw new HttpError("conflict");
      }
      if (result === "created") await deps.stored(target.did);
      return c.body(null, result === "created" ? 201 : 200);
    })
    .get(`${PREFIX}*`, member, async (c) => {
      const record = await meta.getObject(devicePath(c).path);
      const data = record && (await blobs.get(record.hash));
      if (!data) throw new HttpError("not_found");
      return octets(c, data);
    })
    .delete(`${PREFIX}*`, member, async (c) => {
      const target = devicePath(c);
      const state = await group.claimed();
      if (target.did !== c.get("did") && state.members.has(target.did))
        throw new HttpError("forbidden");
      const record = await meta.deleteObject(target.path);
      if (!record) throw new HttpError("not_found");
      if (!(await meta.isHashUsed(record.hash))) await blobs.delete(record.hash);
      return c.body(null, 204);
    })
    .get("/v1/changes", member, async (c) => {
      const { after, limit } = changesSchema.parse(c.req.query());
      const changes = await meta.changesAfter(after, limit);
      const cursor = changes.at(-1)?.cursor ?? after;
      return c.json({
        objects: changes.map(({ path, size }) => ({ path, size })),
        cursor: String(cursor),
      });
    });
}
