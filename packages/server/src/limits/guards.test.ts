import { toHex } from "@flow-sync/protocol";
import { describe, expect, test } from "vitest";
import { LIMITS } from "../limits.ts";
import { claimedApp, testApp } from "../testing/app.ts";
import { signIn } from "../testing/group.ts";
import { ADMIN_TOKEN, bearer, postJson } from "../testing/http.ts";
import { addDevice, append, removal } from "../testing/roster.ts";

/** Longer than any wait; nine of these stay within a token's life and the failure window. */
const SPACED = 65 * 1000;

const from = (ip: string, init: RequestInit = {}): RequestInit => ({
  ...init,
  headers: { ...(init.headers as Record<string, string>), "x-test-ip": ip },
});

describe("request limits", () => {
  test("anonymous requests are limited per address", async () => {
    const { app } = testApp();
    for (let i = 0; i < LIMITS.ipPerMinute; i++) await app.request("/v1/health", from("1.1.1.1"));
    const res = await app.request("/v1/health", from("1.1.1.1"));
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await app.request("/v1/health", from("2.2.2.2"))).status).toBe(200);
  });

  test("an Authorization header without a valid token doesn't escape the address limit", async () => {
    const { app } = testApp();
    for (let i = 0; i < LIMITS.ipPerMinute; i++) {
      await app.request("/v1/health", from("6.6.6.6", bearer("junk")));
    }
    expect((await app.request("/v1/health", from("6.6.6.6", bearer("junk")))).status).toBe(429);
  });

  test("repeated failed authentication bans the address, but not devices with a valid token", async () => {
    const h = await claimedApp();
    const token = await signIn(h.app, h.device, h.group);
    for (let i = 0; i < LIMITS.authFailures; i++) {
      expect((await h.app.request("/v1/status", from("3.3.3.3", bearer("bad")))).status).toBe(401);
      if (i < LIMITS.authFailures - 1) h.clock.now += SPACED;
    }
    const banned = await h.app.request("/v1/status", from("3.3.3.3", bearer("bad")));
    expect(banned.status).toBe(429);
    expect(banned.headers.get("retry-after")).toBe(String(LIMITS.banMs / 1000));
    expect((await h.app.request("/v1/status", from("3.3.3.3", bearer(token)))).status).toBe(200);
    h.clock.now += LIMITS.banMs;
    expect((await h.app.request("/v1/status", from("3.3.3.3", bearer("bad")))).status).toBe(401);
  });

  test("failed authentication makes the address wait before the ban", async () => {
    const h = await claimedApp();
    const status = async () => h.app.request("/v1/status", from("7.7.7.7", bearer("bad")));
    for (let i = 0; i < LIMITS.authBackoffFrom; i++) expect((await status()).status).toBe(401);
    const waiting = await status();
    expect(waiting.status).toBe(429);
    expect(waiting.headers.get("retry-after")).toBe("1");
    h.clock.now += 1000;
    expect((await status()).status).toBe(401);
    const longer = await status();
    expect(longer.status).toBe(429);
    expect(longer.headers.get("retry-after")).toBe("2");
  });

  test("failures far apart don't add up to a ban", async () => {
    const h = await claimedApp();
    for (let i = 0; i < LIMITS.authFailures + 1; i++) {
      expect((await h.app.request("/v1/status", from("8.8.8.8", bearer("bad")))).status).toBe(401);
      h.clock.now += LIMITS.banMs;
    }
  });

  test("an expired token doesn't count as a failure", async () => {
    const h = await claimedApp();
    const token = await signIn(h.app, h.device, h.group);
    h.clock.now += LIMITS.tokenMs;
    for (let i = 0; i < LIMITS.authFailures + 1; i++) {
      expect((await h.app.request("/v1/status", from("9.9.9.9", bearer(token)))).status).toBe(401);
    }
    const did = toHex(h.device.did);
    const renew = await h.app.request("/v1/auth/challenge", from("9.9.9.9", postJson({ did })));
    expect(renew.status).toBe(200);
  });

  test("a removed device's token counts against its address", async () => {
    const h = await claimedApp();
    const token = await signIn(h.app, h.device, h.group);
    const { joining } = await addDevice(h, token);
    const removed = await signIn(h.app, joining, h.group);
    const { entry, wraps, chain, head } = await removal(h, token, toHex(joining.did));
    expect((await append(h, token, { entry, wraps, chain }, head)).status).toBe(201);
    for (let i = 0; i < LIMITS.authFailures; i++) {
      expect((await h.app.request("/v1/status", from("4.4.4.4", bearer(removed)))).status).toBe(
        401,
      );
      h.clock.now += i < LIMITS.authFailures - 1 ? SPACED : 0;
    }
    expect((await h.app.request("/v1/status", from("4.4.4.4", bearer(removed)))).status).toBe(429);
  });

  test("a live connection with a valid token isn't held to its address's ban", async () => {
    const h = await claimedApp();
    const token = await signIn(h.app, h.device, h.group);
    for (let i = 0; i < LIMITS.authFailures; i++) {
      await h.app.request("/v1/status", from("3.3.3.4", bearer("bad")));
      h.clock.now += i < LIMITS.authFailures - 1 ? SPACED : 0;
    }
    const headers = { "sec-websocket-protocol": `flow-sync.v1, bearer.${token}` };
    expect((await h.app.request("/v1/live", from("3.3.3.4", { headers }))).status).not.toBe(429);
  });

  test("wrong admin tokens ban the address sooner", async () => {
    const { app } = testApp();
    for (let i = 0; i < LIMITS.adminFailures; i++) {
      await app.request("/v1/claim", from("5.5.5.5", postJson({}, "wrong")));
    }
    expect(
      (await app.request("/v1/claim", from("5.5.5.5", postJson({}, ADMIN_TOKEN)))).status,
    ).toBe(429);
  });

  test("each device has its own request budget", async () => {
    const h = await claimedApp();
    const token = await signIn(h.app, h.device, h.group);
    for (let i = 0; i < LIMITS.devicePerMinute; i++)
      await h.app.request("/v1/status", bearer(token));
    expect((await h.app.request("/v1/status", bearer(token))).status).toBe(429);
  });

  test("a device's budget covers routes that don't need a member", async () => {
    const h = await claimedApp();
    const token = await signIn(h.app, h.device, h.group);
    for (let i = 0; i < LIMITS.devicePerMinute; i++) {
      await h.app.request("/v1/info", from("1.2.3.4", bearer(token)));
    }
    expect((await h.app.request("/v1/info", from("1.2.3.4", bearer(token)))).status).toBe(429);
  });
});
