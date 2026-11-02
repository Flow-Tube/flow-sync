import { expect, test } from "vitest";
import { openSqlite } from "./storage/sqlite.ts";
import { testApp } from "./testing/app.ts";

test("health, info and the root status", async () => {
  const { app } = testApp();
  expect(await (await app.request("/v1/health")).json()).toEqual({ status: "ok" });
  const info = (await (await app.request("/v1/info")).json()) as {
    limits: Record<string, number>;
  };
  expect(info).toMatchObject({ api: ["v1"], protocol: ["FLOW-SYNC/2"], live: true });
  expect(info.limits.object).toBe(4 * 1024 * 1024);
  expect(await (await app.request("/")).text()).toBe("flow-sync");
});

test("every response carries the security headers", async () => {
  const { app } = testApp();
  for (const path of ["/v1/health", "/missing"]) {
    const res = await app.request(path);
    expect(res.headers.get("content-security-policy")).toBe("default-src 'none'");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  }
});

test("unknown routes answer not_found without echoing the path", async () => {
  const { app, logs } = testApp();
  const res = await app.request("/v1/nothing/secret-name");
  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({ error: "not_found" });
  expect(JSON.stringify(logs)).not.toContain("secret-name");
  expect(logs.at(-1)).toMatchObject({ method: "GET", status: 404, error: "not_found" });
});

test("unexpected errors are logged by class, never by message", async () => {
  const storage = openSqlite(":memory:");
  storage.meta.rosterAfter = () => Promise.reject(new TypeError("secret-detail"));
  const { app, logs, clock } = testApp({}, storage);
  const res = await app.request("/v1/info");
  expect(res.status).toBe(500);
  expect(await res.json()).toEqual({ error: "internal" });
  expect(logs.at(-1)).toMatchObject({
    time: new Date(clock.now).toISOString(),
    error: "internal",
    cause: "TypeError",
  });
  expect(JSON.stringify(logs)).not.toContain("secret-detail");
});

test("security.txt is served only when the operator configures it", async () => {
  expect((await testApp().app.request("/.well-known/security.txt")).status).toBe(404);
  const securityTxt = { contact: "mailto:security@example.org", expires: "2027-10-01T00:00:00Z" };
  const res = await testApp({ securityTxt }).app.request("/.well-known/security.txt");
  expect(await res.text()).toBe(
    "Contact: mailto:security@example.org\nExpires: 2027-10-01T00:00:00Z\n",
  );
});
