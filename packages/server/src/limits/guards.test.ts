import { describe, expect, test } from "vitest";
import { LIMITS } from "../limits.ts";
import { claimedApp, testApp } from "../testing/app.ts";
import { signIn } from "../testing/group.ts";
import { ADMIN_TOKEN, bearer, postJson } from "../testing/http.ts";

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
    }
    const banned = await h.app.request("/v1/status", from("3.3.3.3", bearer("bad")));
    expect(banned.status).toBe(429);
    expect(banned.headers.get("retry-after")).toBe(String(LIMITS.banMs / 1000));
    expect((await h.app.request("/v1/status", from("3.3.3.3", bearer(token)))).status).toBe(200);
    h.clock.now += LIMITS.banMs;
    expect((await h.app.request("/v1/status", from("3.3.3.3", bearer("bad")))).status).toBe(401);
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
});
