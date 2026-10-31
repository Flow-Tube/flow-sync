import {
  blobPath,
  encodePayload,
  ObjectType,
  purposeKey,
  randomBytes,
  sealBlob,
  sha256,
  toHex,
  utf8,
} from "@flow-sync/protocol";
import { describe, expect, test } from "vitest";
import { claimedApp } from "../testing/app.ts";
import { signIn } from "../testing/group.ts";
import { bearer } from "../testing/http.ts";
import { objectUrl, putBytes, sealedObject } from "../testing/objects.ts";
import { addDevice, append, removal } from "../testing/roster.ts";

type Harness = Awaited<ReturnType<typeof claimedApp>>;

async function setup(overrides = {}) {
  const h = await claimedApp(overrides);
  const token = await signIn(h.app, h.device, h.group);
  const object = (seq: number, options = {}) =>
    sealedObject(h.device, seq, { group: h.group, epochKey: h.epochKey, ...options });
  return { ...h, token, object };
}

async function changes(h: Harness, token: string, after = 0) {
  const res = await h.app.request(`/v1/changes?after=${after}`, bearer(token));
  return (await res.json()) as { objects: { path: string; size: number }[]; cursor: string };
}

describe("objects", () => {
  test("a device writes its log once and reads it back", async () => {
    const h = await setup();
    const bytes = h.object(1);
    const url = objectUrl(h.device, 1);
    expect((await h.app.request(url, putBytes(h.token, bytes))).status).toBe(201);
    expect((await h.app.request(url, putBytes(h.token, bytes))).status).toBe(200);
    expect((await h.app.request(url, putBytes(h.token, h.object(1)))).status).toBe(409);
    const res = await h.app.request(url, bearer(h.token));
    expect(res.headers.get("content-type")).toBe("application/octet-stream");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);
    const listed = await changes(h, h.token);
    expect(listed.objects).toEqual([{ path: url.slice(12), size: bytes.length }]);
    expect((await changes(h, h.token, Number(listed.cursor))).objects).toEqual([]);
  });

  test("objects larger than a JSON body are stored", async () => {
    const h = await setup();
    const bytes = h.object(1, {
      content: toHex(randomBytes(50_000)).repeat(2) + toHex(randomBytes(50_000)),
    });
    expect(bytes.length).toBeGreaterThan(64 * 1024);
    expect((await h.app.request(objectUrl(h.device, 1), putBytes(h.token, bytes))).status).toBe(
      201,
    );
  });

  test("objects must match their path, sender, epoch and signature", async () => {
    const h = await setup();
    const url = objectUrl(h.device, 1);
    const otherGroup = sealedObject(h.device, 1, { group: randomBytes(16), epochKey: h.epochKey });
    const tampered = h.object(1);
    tampered[100] = (tampered[100] as number) ^ 1;
    for (const bytes of [
      h.object(2),
      h.object(1, { epoch: 1 }),
      h.object(1, { type: ObjectType.live }),
      otherGroup,
      tampered,
      new Uint8Array(10),
    ]) {
      expect((await h.app.request(url, putBytes(h.token, bytes))).status).toBe(400);
    }
    expect((await h.app.request(url, putBytes(h.token, h.object(1), "text/plain"))).status).toBe(
      415,
    );
    const huge = new Uint8Array(4 * 1024 * 1024 + 1);
    expect((await h.app.request(url, putBytes(h.token, huge))).status).toBe(413);
    expect(
      (await h.app.request("/v1/objects/roster/x.r", putBytes(h.token, h.object(1)))).status,
    ).toBe(404);
  });

  test("a device can't write as another device, and the recovery key can't write", async () => {
    const h = await setup();
    const { joining } = await addDevice(h, h.token);
    const theirs = sealedObject(joining, 1, { group: h.group, epochKey: h.epochKey });
    expect((await h.app.request(objectUrl(joining, 1), putBytes(h.token, theirs))).status).toBe(
      403,
    );
    const recoveryToken = await signIn(h.app, h.recovery, h.group);
    expect(
      (await h.app.request(objectUrl(h.device, 1), putBytes(recoveryToken, h.object(1)))).status,
    ).toBe(403);
  });

  test("snapshot blobs are stored under their hash", async () => {
    const h = await setup();
    const key = purposeKey(h.epochKey, h.group, 0, "snapshot");
    const blob = sealBlob(key, h.group, 0, h.device.did, encodePayload(utf8("{}")));
    const did = toHex(h.device.did);
    const good = `/v1/objects/${blobPath(did, toHex(sha256(blob)))}`;
    expect((await h.app.request(good, putBytes(h.token, blob))).status).toBe(201);
    const wrong = `/v1/objects/${blobPath(did, "0".repeat(64))}`;
    expect((await h.app.request(wrong, putBytes(h.token, blob))).status).toBe(400);
  });

  test("writes stop at the instance quota", async () => {
    const h = await setup();
    const first = h.object(1);
    const small = await setup({ quota: first.length + 10 });
    expect(
      (await small.app.request(objectUrl(small.device, 1), putBytes(small.token, small.object(1))))
        .status,
    ).toBe(201);
    const res = await small.app.request(
      objectUrl(small.device, 2),
      putBytes(small.token, small.object(2)),
    );
    expect(res.status).toBe(507);
    expect(await res.json()).toEqual({ error: "quota" });
  });

  test("a device deletes its own objects and those of removed devices", async () => {
    const h = await setup();
    const url = objectUrl(h.device, 1);
    const bytes = h.object(1);
    await h.app.request(url, putBytes(h.token, bytes));
    const { joining } = await addDevice(h, h.token);
    const joinedToken = await signIn(h.app, joining, h.group);
    const theirUrl = objectUrl(joining, 1);
    await h.app.request(
      theirUrl,
      putBytes(joinedToken, sealedObject(joining, 1, { group: h.group, epochKey: h.epochKey })),
    );
    expect((await h.app.request(url, { method: "DELETE", ...bearer(joinedToken) })).status).toBe(
      403,
    );
    expect((await h.app.request(url, { method: "DELETE", ...bearer(h.token) })).status).toBe(204);
    expect((await h.app.request(url, bearer(h.token))).status).toBe(404);
    expect(await h.storage.blobs.get(toHex(sha256(bytes)))).toBeUndefined();
    const { entry, wraps, chain, head } = await removal(h, h.token, toHex(joining.did));
    await append(h, h.token, { entry, wraps, chain }, head);
    expect((await h.app.request(theirUrl, { method: "DELETE", ...bearer(h.token) })).status).toBe(
      204,
    );
    expect((await h.app.request(theirUrl, { method: "DELETE", ...bearer(h.token) })).status).toBe(
      404,
    );
  });
});
