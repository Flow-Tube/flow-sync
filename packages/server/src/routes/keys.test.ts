import { toB64, toHex } from "@flow-sync/protocol";
import { describe, expect, test } from "vitest";
import { claimedApp } from "../testing/app.ts";
import { signIn } from "../testing/group.ts";
import { bearer } from "../testing/http.ts";
import { addDevice, append, removal } from "../testing/roster.ts";

describe("keys", () => {
  test("a member reads its own wrap and the chain, nothing else", async () => {
    const h = await claimedApp();
    const token = await signIn(h.app, h.device, h.group);
    const own = `/v1/keys/00000000/${toHex(h.device.did)}.k`;
    const res = await h.app.request(own, bearer(token));
    expect(res.headers.get("content-type")).toBe("application/octet-stream");
    expect(res.headers.get("content-disposition")).toBe("attachment");
    expect(toB64(new Uint8Array(await res.arrayBuffer()))).toBe(h.wraps[toHex(h.device.did)]);
    const other = `/v1/keys/00000000/${toHex(h.recovery.did)}.k`;
    expect((await h.app.request(other, bearer(token))).status).toBe(403);
    expect((await h.app.request("/v1/keys/00000000/chain.k", bearer(token))).status).toBe(404);
    expect((await h.app.request("/v1/keys/0/x.k", bearer(token))).status).toBe(404);
    expect((await h.app.request(own)).status).toBe(401);
  });

  test("after a removal the remaining members read the new epoch", async () => {
    const h = await claimedApp();
    const token = await signIn(h.app, h.device, h.group);
    const { joining } = await addDevice(h, token);
    const { entry, wraps, chain, head } = await removal(h, token, toHex(joining.did));
    expect((await append(h, token, { entry, wraps, chain }, head)).status).toBe(201);
    const recoveryToken = await signIn(h.app, h.recovery, h.group);
    const wrap = await h.app.request(
      `/v1/keys/00000001/${toHex(h.recovery.did)}.k`,
      bearer(recoveryToken),
    );
    expect(toB64(new Uint8Array(await wrap.arrayBuffer()))).toBe(wraps[toHex(h.recovery.did)]);
    const box = await h.app.request("/v1/keys/00000001/chain.k", bearer(token));
    expect(toB64(new Uint8Array(await box.arrayBuffer()))).toBe(chain);
  });
});
