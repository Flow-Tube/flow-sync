import { concat, fromB64, fromHex, sign, tag, toB64, toHex } from "@flow-sync/protocol";
import { describe, expect, test } from "vitest";
import { LIMITS } from "../limits.ts";
import { claimedApp, testApp } from "../testing/app.ts";
import { newDevice, signIn } from "../testing/group.ts";
import { bearer, postJson } from "../testing/http.ts";

type Challenge = { challenge: string; instance: string; group: string; time: number };

async function challenge(app: Awaited<ReturnType<typeof claimedApp>>["app"], did: string) {
  return (await (await app.request("/v1/auth/challenge", postJson({ did }))).json()) as Challenge;
}

describe("device authentication", () => {
  test("a member signs a challenge and uses the token", async () => {
    const { app, device, group, clock } = await claimedApp();
    const token = await signIn(app, device, group);
    const res = await app.request("/v1/status", bearer(token));
    expect(res.status).toBe(200);
    const status = (await res.json()) as { devices: Record<string, { seen: number }> };
    expect(status.devices).toEqual({ [toHex(device.did)]: { seen: clock.now } });
  });

  test("a challenge works once, for its device, before it expires", async () => {
    const { app, device, group, clock } = await claimedApp();
    const did = toHex(device.did);
    const exchange = async (c: Challenge, signer = device, as = did) => {
      const message = concat(tag("auth"), fromHex(c.instance), group, fromB64(c.challenge));
      const sig = toB64(sign(signer.sigSeed, message));
      return (
        await app.request("/v1/auth/token", postJson({ did: as, challenge: c.challenge, sig }))
      ).status;
    };
    const first = await challenge(app, did);
    expect(first.group).toBe(toHex(group));
    expect(await exchange(first)).toBe(200);
    expect(await exchange(first)).toBe(401);
    const stale = await challenge(app, did);
    clock.now += LIMITS.challengeMs;
    expect(await exchange(stale)).toBe(401);
    expect(await exchange(await challenge(app, did), newDevice())).toBe(401);
    const other = toHex(newDevice().did);
    clock.now += 1000;
    const refused = await app.request("/v1/auth/challenge", postJson({ did: other }));
    expect(refused.status).toBe(401);
  });

  test("tokens expire and can't be altered", async () => {
    const { app, device, group, clock } = await claimedApp();
    const token = await signIn(app, device, group);
    const altered = `${token.slice(0, -2)}${token.endsWith("A") ? "B" : "A"}A`;
    expect((await app.request("/v1/status", bearer(altered))).status).toBe(401);
    expect((await app.request("/v1/status")).status).toBe(401);
    clock.now += LIMITS.tokenMs;
    expect((await app.request("/v1/status", bearer(token))).status).toBe(401);
  });

  test("the recovery member authenticates but can't use device routes", async () => {
    const { app, recovery, group } = await claimedApp();
    const token = await signIn(app, recovery, group);
    expect(token).toBeTypeOf("string");
    expect((await app.request("/v1/status", bearer(token))).status).toBe(403);
  });

  test("an unclaimed instance refuses authentication", async () => {
    const { app } = testApp();
    const res = await app.request("/v1/auth/challenge", postJson({ did: "0".repeat(32) }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "unclaimed" });
  });
});
