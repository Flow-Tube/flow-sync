import {
  buildEntry,
  type Entry,
  epochDraft,
  memberSubject,
  randomBytes,
  replayRoster,
  sealChain,
  toB64,
  toHex,
  wrapEpochKey,
} from "@flow-sync/protocol";
import { describe, expect, test } from "vitest";
import { bearer, claimedApp, postJson } from "../testing/app.ts";
import { newDevice, signIn } from "../testing/group.ts";

type Harness = Awaited<ReturnType<typeof claimedApp>>;

async function entries(h: Harness, token: string, after = -1) {
  const res = await h.app.request(`/v1/roster?after=${after}`, bearer(token));
  return ((await res.json()) as { entries: Entry[] }).entries;
}

async function append(h: Harness, token: string, body: unknown, head: string) {
  const init = postJson(body, token);
  init.headers = { ...init.headers, "if-match": `"${head}"` };
  return h.app.request("/v1/roster", init);
}

async function addDevice(h: Harness, token: string) {
  const state = replayRoster(await entries(h, token));
  const joining = newDevice();
  const entry = buildEntry(
    h.group,
    state,
    { op: "add", signer: toHex(h.device.did), add: [memberSubject(joining, "device")] },
    [h.device, joining],
  );
  const res = await append(h, token, { entry, wraps: {} }, state.head);
  return { joining, res };
}

async function removal(h: Harness, token: string, removed: string) {
  const state = replayRoster(await entries(h, token));
  const key = randomBytes(32);
  const remaining = [h.device, h.recovery];
  const entry = buildEntry(
    h.group,
    state,
    {
      op: "remove",
      signer: toHex(h.device.did),
      remove: [removed],
      epoch: epochDraft(key, h.group, 1, remaining),
    },
    [h.device],
  );
  const wraps: Record<string, string> = {};
  for (const m of remaining)
    wraps[toHex(m.did)] = toB64(await wrapEpochKey(m.kemPublic, h.group, 1, m.did, key));
  return { entry, wraps, chain: toB64(sealChain(key, h.group, 1, h.epochKey)), head: state.head };
}

describe("roster", () => {
  test("members read the roster from any point", async () => {
    const h = await claimedApp();
    const token = await signIn(h.app, h.device, h.group);
    expect(await entries(h, token)).toEqual([h.entry]);
    expect(await entries(h, token, 0)).toEqual([]);
    const recoveryToken = await signIn(h.app, h.recovery, h.group);
    expect(await entries(h, recoveryToken)).toHaveLength(1);
  });

  test("an added device can sign in", async () => {
    const h = await claimedApp();
    const token = await signIn(h.app, h.device, h.group);
    const { joining, res } = await addDevice(h, token);
    expect(res.status).toBe(201);
    expect(await entries(h, token)).toHaveLength(2);
    const joinedToken = await signIn(h.app, joining, h.group);
    expect((await h.app.request("/v1/status", bearer(joinedToken))).status).toBe(200);
  });

  test("an append naming a stale head is refused with the current head", async () => {
    const h = await claimedApp();
    const token = await signIn(h.app, h.device, h.group);
    const head = replayRoster(await entries(h, token)).head;
    await addDevice(h, token);
    const res = await append(h, token, { entry: h.entry, wraps: {} }, head);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "conflict",
      head: replayRoster(await entries(h, token)).head,
    });
  });

  test("entries that fail validation are refused", async () => {
    const h = await claimedApp();
    const token = await signIn(h.app, h.device, h.group);
    const state = replayRoster(await entries(h, token));
    const stranger = newDevice();
    const entry = buildEntry(
      h.group,
      state,
      { op: "add", signer: toHex(stranger.did), add: [memberSubject(stranger, "device")] },
      [stranger],
    );
    expect((await append(h, token, { entry, wraps: {} }, state.head)).status).toBe(400);
    const huge = { ...entry, meta: { [toHex(h.device.did)]: "x".repeat(17_000) } };
    expect((await append(h, token, { entry: huge, wraps: {} }, state.head)).status).toBe(413);
  });

  test("removal needs every wrap and the chain, and revokes the device at once", async () => {
    const h = await claimedApp();
    const token = await signIn(h.app, h.device, h.group);
    const { joining } = await addDevice(h, token);
    const removedToken = await signIn(h.app, joining, h.group);
    const remove = await removal(h, token, toHex(joining.did));
    const [firstWrap] = Object.keys(remove.wraps);
    const partial = { ...remove.wraps };
    delete partial[firstWrap as string];
    expect(
      (
        await append(
          h,
          token,
          { entry: remove.entry, wraps: partial, chain: remove.chain },
          remove.head,
        )
      ).status,
    ).toBe(400);
    expect(
      (await append(h, token, { entry: remove.entry, wraps: remove.wraps }, remove.head)).status,
    ).toBe(400);
    const res = await append(
      h,
      token,
      { entry: remove.entry, wraps: remove.wraps, chain: remove.chain },
      remove.head,
    );
    expect(res.status).toBe(201);
    expect((await h.app.request("/v1/status", bearer(removedToken))).status).toBe(401);
    expect((await h.app.request("/v1/roster", bearer(removedToken))).status).toBe(401);
  });
});
