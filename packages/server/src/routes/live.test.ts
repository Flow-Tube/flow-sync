import { ObjectType, toHex } from "@flow-sync/protocol";
import { fuzzRuns, mutations } from "@flow-sync/protocol/testing";
import fc from "fast-check";
import { afterEach, describe, expect, test } from "vitest";
import { claimedApp } from "../testing/app.ts";
import { signIn } from "../testing/group.ts";
import { closeServers, connect, serveLive } from "../testing/live.ts";
import { objectUrl, putBytes, sealedObject } from "../testing/objects.ts";
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

  test("a stored object tells the other devices to sync", async () => {
    const h = await setup();
    const a = await connect(h.port, h.tokenA);
    await a.next();
    const b = await connect(h.port, h.tokenB);
    await a.next();
    await b.next();
    const bytes = sealedObject(h.joining, 1, { group: h.group, epochKey: h.epochKey });
    expect((await h.app.request(objectUrl(h.joining, 1), putBytes(h.tokenB, bytes))).status).toBe(
      201,
    );
    expect(await a.next()).toBe(JSON.stringify({ type: "changed" }));
  });

  test("a connection needs a valid token", async () => {
    const h = await setup();
    await expect(connect(h.port, "invalid")).rejects.toThrow();
  });

  test("any change to a live message closes the sender and reaches no one", async () => {
    const h = await setup();
    const b = await connect(h.port, h.tokenB);
    await b.next();
    await fc.assert(
      fc.asyncProperty(mutations(h.live()), async (changed) => {
        // Stays under the per-address connection rate and the per-device message rate.
        h.clock.now += 600;
        const a = await connect(h.port, h.tokenA);
        a.socket.send(changed);
        expect(await a.closed).toBe(1008);
      }),
      fuzzRuns(30),
    );
    const a = await connect(h.port, h.tokenA);
    const message = h.live();
    a.socket.send(message);
    let next = await b.next();
    while (typeof next === "string") next = await b.next();
    expect(next).toEqual(message);
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
    await h.relay?.sweep();
    expect(await b.closed).toBe(1008);
  });
});
