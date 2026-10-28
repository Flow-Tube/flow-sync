import { pairingSlot, randomBytes, toHex } from "@flow-sync/protocol";
import { describe, expect, test } from "vitest";
import { LIMITS } from "../limits.ts";
import { bearer, claimedApp, postJson } from "../testing/app.ts";
import { signIn } from "../testing/group.ts";

const put = (bytes: Uint8Array): RequestInit => ({
  method: "PUT",
  headers: { "content-type": "application/octet-stream" },
  body: bytes,
});

async function setup() {
  const h = await claimedApp();
  const token = await signIn(h.app, h.device, h.group);
  const slot = toHex(pairingSlot(randomBytes(16)));
  const open = (id = slot) => h.app.request("/v1/pair", postJson({ slot: id }, token));
  const url = (name: string, id = slot) => `/v1/pair/${id}/${name}`;
  return { ...h, token, slot, open, url };
}

describe("pairing mailbox", () => {
  test("a member opens a slot and both sides exchange messages without a token", async () => {
    const h = await setup();
    expect((await h.open()).status).toBe(201);
    expect((await h.open()).status).toBe(409);
    const message = randomBytes(200);
    const name = "b-0000000000000000.p";
    expect((await h.app.request(h.url(name), put(message))).status).toBe(201);
    expect((await h.app.request(h.url(name), put(message))).status).toBe(200);
    expect((await h.app.request(h.url(name), put(randomBytes(200)))).status).toBe(409);
    const res = await h.app.request(h.url(name));
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(message);
    expect((await h.app.request(h.url("a-0000000000000000.p"))).status).toBe(404);
  });

  test("messages are bounded in number and size", async () => {
    const h = await setup();
    await h.open();
    const last = `a-${LIMITS.pairMessages.toString(16).padStart(16, "0")}.p`;
    expect((await h.app.request(h.url(last), put(randomBytes(200)))).status).toBe(400);
    expect((await h.app.request(h.url("a-0000000000000000.p"), put(randomBytes(10)))).status).toBe(
      400,
    );
    const big = randomBytes(LIMITS.pairMessage + 1);
    expect((await h.app.request(h.url("a-0000000000000000.p"), put(big))).status).toBe(413);
  });

  test("slots expire, can be closed, and only a few are open at once", async () => {
    const h = await setup();
    const name = "a-0000000000000000.p";
    await h.open();
    for (let i = 1; i < LIMITS.pairSlots; i++) await h.open(toHex(randomBytes(16)));
    expect((await h.open(toHex(randomBytes(16)))).status).toBe(409);
    expect(
      (await h.app.request(`/v1/pair/${h.slot}`, { method: "DELETE", ...bearer(h.token) })).status,
    ).toBe(204);
    expect((await h.app.request(h.url(name), put(randomBytes(200)))).status).toBe(404);
    h.clock.now += LIMITS.pairMs;
    expect((await h.open(toHex(randomBytes(16)))).status).toBe(201);
    expect((await h.app.request(h.url(name), put(randomBytes(200)))).status).toBe(404);
  });

  test("an unknown slot looks like any missing message", async () => {
    const h = await setup();
    expect((await h.app.request(h.url("a-0000000000000000.p"))).status).toBe(404);
  });
});
