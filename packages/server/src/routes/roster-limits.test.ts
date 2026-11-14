import {
  applyEntry,
  buildEntry,
  type RosterState,
  replayRoster,
  toHex,
  utf8,
} from "@flow-sync/protocol";
import { describe, expect, test } from "vitest";
import { LIMITS } from "../limits.ts";
import { claimedApp } from "../testing/app.ts";
import { signIn } from "../testing/group.ts";
import { bearer } from "../testing/http.ts";
import { append, entries } from "../testing/roster.ts";

type Harness = Awaited<ReturnType<typeof claimedApp>>;

const rename = (h: Harness, state: RosterState, value: string) =>
  buildEntry(
    h.group,
    state,
    { op: "rename", signer: toHex(h.device.did), meta: { [toHex(h.device.did)]: value } },
    [h.device],
  );

/** A rename of exactly `size` bytes. */
function renameOfSize(h: Harness, state: RosterState, size: number) {
  const overhead = utf8(JSON.stringify(rename(h, state, ""))).length;
  return rename(h, state, "A".repeat(size - overhead));
}

async function setup() {
  const h = await claimedApp();
  const token = await signIn(h.app, h.device, h.group);
  return { h, token, state: replayRoster(await entries(h, token)) };
}

describe("roster entry size", () => {
  test("the limit counts UTF-8 bytes, not string length", async () => {
    const { h, token, state } = await setup();
    const entry = rename(h, state, "€".repeat(6_000));
    expect(JSON.stringify(entry).length).toBeLessThan(LIMITS.rosterEntry);
    expect((await append(h, token, { entry, wraps: {} }, state.head)).status).toBe(413);
  });

  test("an entry may be exactly the limit and no more", async () => {
    const { h, token, state } = await setup();
    const over = renameOfSize(h, state, LIMITS.rosterEntry + 1);
    expect((await append(h, token, { entry: over, wraps: {} }, state.head)).status).toBe(413);
    const fits = renameOfSize(h, state, LIMITS.rosterEntry);
    expect((await append(h, token, { entry: fits, wraps: {} }, state.head)).status).toBe(201);
  });

  test("a meta value outside the alphabet is refused", async () => {
    const { h, token, state } = await setup();
    for (const value of ["not base64url!", "AAAA=", "€", "AAAA\n", ""]) {
      const entry = rename(h, state, value);
      expect((await append(h, token, { entry, wraps: {} }, state.head)).status).toBe(400);
    }
  });

  test("a full page of the largest entries fits what a device may read", async () => {
    const { h, token, state: start } = await setup();
    let state = start;
    for (let i = 0; i < LIMITS.rosterPage; i++) {
      h.clock.now += 200;
      const entry = renameOfSize(h, state, LIMITS.rosterEntry);
      expect((await append(h, token, { entry, wraps: {} }, state.head)).status).toBe(201);
      state = applyEntry(state, entry);
    }
    const res = await h.app.request("/v1/roster", bearer(token));
    expect((await res.arrayBuffer()).byteLength).toBeLessThan(16 * 1024 * 1024);
  }, 60_000);
});
