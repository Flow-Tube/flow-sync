import { buildEntry, leaveDraft, memberSubject, replayRoster, toHex } from "@flow-sync/protocol";
import { describe, expect, test } from "vitest";
import { claimedApp } from "../testing/app.ts";
import { newDevice, signIn } from "../testing/group.ts";
import { bearer } from "../testing/http.ts";
import { addDevice, append, entries, removal, rotation } from "../testing/roster.ts";

describe("roster", () => {
  test("members read the roster from any point", async () => {
    const h = await claimedApp();
    const token = await signIn(h.app, h.device, h.group);
    expect(await entries(h, token)).toEqual([h.entry]);
    expect(await entries(h, token, 0)).toEqual([]);
    const recoveryToken = await signIn(h.app, h.recovery, h.group);
    expect(await entries(h, recoveryToken)).toHaveLength(1);
  });

  test("an added device can sign in and read its wrap of the current epoch", async () => {
    const h = await claimedApp();
    const token = await signIn(h.app, h.device, h.group);
    const { joining, res } = await addDevice(h, token);
    expect(res.status).toBe(201);
    const wrapUrl = `/v1/keys/00000000/${toHex(joining.did)}.k`;
    const joined = await signIn(h.app, joining, h.group);
    expect((await h.app.request(wrapUrl, bearer(joined))).status).toBe(200);
    expect(await entries(h, token)).toHaveLength(2);
    const joinedToken = await signIn(h.app, joining, h.group);
    expect((await h.app.request("/v1/status", bearer(joinedToken))).status).toBe(200);
  });

  test("an add entry must carry the new device's wrap", async () => {
    const h = await claimedApp();
    const token = await signIn(h.app, h.device, h.group);
    const state = replayRoster(await entries(h, token));
    const joining = newDevice();
    const entry = buildEntry(
      h.group,
      state,
      { op: "add", signer: toHex(h.device.did), add: [memberSubject(joining, "device")] },
      [h.device, joining],
    );
    expect((await append(h, token, { entry, wraps: {} }, state.head)).status).toBe(400);
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

  test("a device that leaves is revoked at once, and the next epoch excludes it", async () => {
    const h = await claimedApp();
    const token = await signIn(h.app, h.device, h.group);
    const { joining } = await addDevice(h, token);
    const leavingToken = await signIn(h.app, joining, h.group);
    const state = replayRoster(await entries(h, token));
    const entry = buildEntry(h.group, state, leaveDraft(joining), [joining]);
    expect((await append(h, leavingToken, { entry, wraps: {} }, state.head)).status).toBe(201);
    expect((await h.app.request("/v1/status", bearer(leavingToken))).status).toBe(401);
    expect(replayRoster(await entries(h, token)).rotate).toBe(true);
    const rotate = await rotation(h, token);
    const res = await append(
      h,
      token,
      { entry: rotate.entry, wraps: rotate.wraps, chain: rotate.chain },
      rotate.head,
    );
    expect(res.status).toBe(201);
    expect(replayRoster(await entries(h, token)).rotate).toBe(false);
  });
});
