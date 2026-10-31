import {
  buildEntry,
  type Entry,
  epochDraft,
  memberSubject,
  randomBytes,
  replayRoster,
  rotateDraft,
  sealChain,
  toB64,
  toHex,
  wrapEpochKey,
} from "@flow-sync/protocol";
import { type App, type genesis, newDevice } from "./group.ts";
import { bearer, postJson } from "./http.ts";

export type Harness = { app: App } & Awaited<ReturnType<typeof genesis>>;

export async function entries(h: Harness, token: string, after = -1) {
  const res = await h.app.request(`/v1/roster?after=${after}`, bearer(token));
  return ((await res.json()) as { entries: Entry[] }).entries;
}

export async function append(h: Harness, token: string, body: unknown, head: string) {
  const init = postJson(body, token);
  init.headers = { ...init.headers, "if-match": `"${head}"` };
  return h.app.request("/v1/roster", init);
}

export async function addDevice(h: Harness, token: string) {
  const state = replayRoster(await entries(h, token));
  const joining = newDevice();
  const entry = buildEntry(
    h.group,
    state,
    { op: "add", signer: toHex(h.device.did), add: [memberSubject(joining, "device")] },
    [h.device, joining],
  );
  const wrap = await wrapEpochKey(joining.kemPublic, h.group, 0, joining.did, h.epochKey);
  const wraps = { [toHex(joining.did)]: toB64(wrap) };
  const res = await append(h, token, { entry, wraps }, state.head);
  return { joining, res };
}

/** A new epoch for the device and the recovery member, with its wraps and chain box. */
async function nextEpoch(h: Harness) {
  const key = randomBytes(32);
  const remaining = [h.device, h.recovery];
  const wraps: Record<string, string> = {};
  for (const m of remaining)
    wraps[toHex(m.did)] = toB64(await wrapEpochKey(m.kemPublic, h.group, 1, m.did, key));
  return { key, remaining, wraps, chain: toB64(sealChain(key, h.group, 1, h.epochKey)) };
}

export async function removal(h: Harness, token: string, removed: string) {
  const state = replayRoster(await entries(h, token));
  const { key, remaining, wraps, chain } = await nextEpoch(h);
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
  return { entry, wraps, chain, head: state.head };
}

export async function rotation(h: Harness, token: string) {
  const state = replayRoster(await entries(h, token));
  const { key, remaining, wraps, chain } = await nextEpoch(h);
  const entry = buildEntry(h.group, state, rotateDraft(h.device, key, h.group, 1, remaining), [
    h.device,
  ]);
  return { entry, wraps, chain, head: state.head };
}
