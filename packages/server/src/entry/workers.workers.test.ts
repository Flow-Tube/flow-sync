import { env, evictAllDurableObjects, SELF } from "cloudflare:test";
import { ObjectType, toHex } from "@flow-sync/protocol";
import { beforeEach, describe, expect, test } from "vitest";
import { LIVE_PROTOCOL } from "../routes/live.ts";
import { type App, claim, signIn } from "../testing/group.ts";
import { ADMIN_TOKEN, postJson } from "../testing/http.ts";
import { objectUrl, putBytes, sealedObject } from "../testing/objects.ts";
import { addDevice, append, removal } from "../testing/roster.ts";
import { track } from "../testing/socket.ts";

const app: App = { request: (path, init) => SELF.fetch(`https://flow-sync.test${path}`, init) };

/** Storage lasts for the whole test file here, so each test starts from an admin reset. */
beforeEach(async () => {
  await app.request("/v1/admin/reset", postJson({ confirm: "reset" }, ADMIN_TOKEN));
});

async function connect(token: string) {
  const res = await app.request("/v1/live", {
    headers: {
      upgrade: "websocket",
      "sec-websocket-protocol": `${LIVE_PROTOCOL}, bearer.${token}`,
    },
  });
  const socket = res.webSocket;
  if (!socket) throw new Error(`live refused: ${res.status}`);
  expect(res.headers.get("sec-websocket-protocol")).toBe(LIVE_PROTOCOL);
  socket.accept();
  socket.binaryType = "arraybuffer";
  return track(socket as unknown as WebSocket);
}

async function setup() {
  const h = { app, ...(await claim(app)) };
  const tokenA = await signIn(app, h.device, h.group);
  const { joining } = await addDevice(h, tokenA);
  const tokenB = await signIn(app, joining, h.group);
  const live = (sender = h.device, counter = 1) =>
    sealedObject(sender, counter, { group: h.group, epochKey: h.epochKey, type: ObjectType.live });
  const peers = JSON.stringify({
    type: "peers",
    online: [toHex(h.device.did), toHex(joining.did)].sort(),
  });
  return { ...h, joining, tokenA, tokenB, live, peers };
}

describe("workers", () => {
  test("objects round-trip through D1 and R2", async () => {
    const h = await setup();
    const bytes = sealedObject(h.device, 1, { group: h.group, epochKey: h.epochKey });
    expect((await app.request(objectUrl(h.device, 1), putBytes(h.tokenA, bytes))).status).toBe(201);
    const res = await app.request(objectUrl(h.device, 1), {
      headers: { authorization: `Bearer ${h.tokenB}` },
    });
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);
    expect(await env.BLOBS.list()).toMatchObject({ objects: [{ size: bytes.length }] });
  });

  test("live messages reach the other devices, also after the room hibernates", async () => {
    const h = await setup();
    const a = await connect(h.tokenA);
    await a.next();
    const b = await connect(h.tokenB);
    expect(await a.next()).toBe(h.peers);
    expect(await b.next()).toBe(h.peers);
    const message = h.live();
    a.socket.send(message);
    expect(await b.next()).toEqual(message);
    await evictAllDurableObjects();
    const reply = h.live(h.joining);
    b.socket.send(reply);
    expect(await a.next()).toEqual(reply);
  });

  test("a stored object tells the other devices to sync", async () => {
    const h = await setup();
    const a = await connect(h.tokenA);
    await a.next();
    const bytes = sealedObject(h.joining, 1, { group: h.group, epochKey: h.epochKey });
    expect((await app.request(objectUrl(h.joining, 1), putBytes(h.tokenB, bytes))).status).toBe(
      201,
    );
    expect(await a.next()).toBe(JSON.stringify({ type: "changed" }));
  });

  test("a connection needs a valid token and an upgrade", async () => {
    const h = await setup();
    await expect(connect("invalid")).rejects.toThrow("401");
    const plain = { headers: { "sec-websocket-protocol": `${LIVE_PROTOCOL}, bearer.${h.tokenA}` } };
    expect((await app.request("/v1/live", plain)).status).toBe(404);
  });

  test("text frames and messages that fail the reader's checks close the sender", async () => {
    const h = await setup();
    const a = await connect(h.tokenA);
    a.socket.send("hello");
    expect(await a.closed).toBe(1003);
    const again = await connect(h.tokenA);
    again.socket.send(h.live(h.joining));
    expect(await again.closed).toBe(1008);
  });

  test("a device holds at most two connections", async () => {
    const h = await setup();
    await connect(h.tokenA);
    await connect(h.tokenA);
    const third = await connect(h.tokenA);
    expect(await third.closed).toBe(1008);
  });

  test("a removed device is disconnected as soon as the removal is stored", async () => {
    const h = await setup();
    const b = await connect(h.tokenB);
    const { entry, wraps, chain, head } = await removal(h, h.tokenA, toHex(h.joining.did));
    expect((await append(h, h.tokenA, { entry, wraps, chain }, head)).status).toBe(201);
    expect(await b.closed).toBe(1008);
  });
});
