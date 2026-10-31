import { sha256, toHex } from "@flow-sync/protocol";
import { describe, expect, test } from "vitest";
import { ADMIN_TOKEN, bearer, claimedApp, postJson, testApp } from "../testing/app.ts";
import { signIn } from "../testing/group.ts";
import { objectUrl, putBytes, sealedObject } from "../testing/objects.ts";

describe("admin", () => {
  test("usage reports sizes and counts only", async () => {
    const h = await claimedApp();
    const token = await signIn(h.app, h.device, h.group);
    const bytes = sealedObject(h.device, 1, { group: h.group, epochKey: h.epochKey });
    await h.app.request(objectUrl(h.device, 1), putBytes(token, bytes));
    const res = await h.app.request("/v1/admin/usage", bearer(ADMIN_TOKEN));
    expect(await res.json()).toEqual({
      used: bytes.length,
      quota: h.config.quota,
      objects: 1,
      rosterEntries: 1,
      devices: 1,
    });
    expect((await h.app.request("/v1/admin/usage", bearer(token))).status).toBe(401);
  });

  test("reset deletes the group and the instance can be claimed again", async () => {
    const h = await claimedApp();
    const token = await signIn(h.app, h.device, h.group);
    const bytes = sealedObject(h.device, 1, { group: h.group, epochKey: h.epochKey });
    await h.app.request(objectUrl(h.device, 1), putBytes(token, bytes));
    expect(
      (await h.app.request("/v1/admin/reset", postJson({ confirm: "no" }, ADMIN_TOKEN))).status,
    ).toBe(400);
    expect(
      (await h.app.request("/v1/admin/reset", postJson({ confirm: "reset" }, ADMIN_TOKEN))).status,
    ).toBe(204);
    expect(await h.storage.blobs.get(toHex(sha256(bytes)))).toBeUndefined();
    expect((await h.app.request("/v1/status", bearer(token))).status).toBe(503);
    const claim = await h.app.request(
      "/v1/claim",
      postJson({ entry: h.entry, wraps: h.wraps }, ADMIN_TOKEN),
    );
    expect(claim.status).toBe(201);
  });

  test("admin routes are closed when admin access is off", async () => {
    const h = await claimedApp();
    const off = testApp({ adminTokenHash: undefined });
    expect((await h.app.request("/v1/admin/usage", bearer(ADMIN_TOKEN))).status).toBe(200);
    expect((await off.app.request("/v1/admin/usage", bearer(ADMIN_TOKEN))).status).toBe(401);
  });
});
