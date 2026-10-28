import { ObjectType, toHex } from "@flow-sync/protocol";
import { afterEach, describe, expect, test } from "vitest";
import { claimedApp } from "../testing/app.ts";
import { signIn } from "../testing/group.ts";
import { closeServers, connect, serveLive } from "../testing/live.ts";
import { sealedObject } from "../testing/objects.ts";
import { addDevice, append, removal } from "../testing/roster.ts";

afterEach(closeServers);

async function setup() {
  const h = await claimedApp();
  const tokenA = await signIn(h.app, h.device, h.group);
  const { joining } = await addDevice(h, tokenA);
  const tokenB = await signIn(h.app, joining, h.group);
  const port = await serveLive(h);
  const live = (sender = h.device, counter = 1) =>
    sealedObject(sender, counter, { group: h.group, epochKey: h.epochKey, type: ObjectType.live });
  const peers = JSON.stringify({
    type: "peers",
    online: [toHex(h.device.did), toHex(joining.did)].sort(),
  });
  return { ...h, joining, tokenA, tokenB, port, live, peers };
}

describe("live relay", () => {
  test("messages reach the other devices, never the sender", async () => {
    const h = await setup();
    const a = await connect(h.port, h.tokenA);
    await a.next();
    const b = await connect(h.port, h.tokenB);
    expect(await a.next()).toBe(h.peers);
    expect(await b.next()).toBe(h.peers);
    const message = h.live();
    a.socket.send(message);
    expect(await b.next()).toEqual(message);
    const reply = h.live(h.joining);
    b.socket.send(reply);
    expect(await a.next()).toEqual(reply);
  });

  test("a connection needs a valid token", async () => {
    const h = await setup();
    await expect(connect(h.port, "invalid")).rejects.toThrow();
  });

  test("text frames and messages that fail the reader's checks close the sender", async () => {
    const h = await setup();
    const a = await connect(h.port, h.tokenA);
    a.socket.send("hello");
    expect(await a.closed).toBe(1003);
    const again = await connect(h.port, h.tokenA);
    again.socket.send(h.live(h.joining));
    expect(await again.closed).toBe(1008);
  });

  test("a device holds at most two connections", async () => {
    const h = await setup();
    await connect(h.port, h.tokenA);
    await connect(h.port, h.tokenA);
    const third = await connect(h.port, h.tokenA);
    expect(await third.closed).toBe(1008);
  });

  test("a removed device is disconnected by the sweep", async () => {
    const h = await setup();
    const b = await connect(h.port, h.tokenB);
    const { entry, wraps, chain, head } = await removal(h, h.tokenA, toHex(h.joining.did));
    expect((await append(h, h.tokenA, { entry, wraps, chain }, head)).status).toBe(201);
    await h.hub.sweep();
    expect(await b.closed).toBe(1008);
  });
});
