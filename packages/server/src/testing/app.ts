import { createApp } from "../app.ts";
import { type Config, loadConfig } from "../config.ts";
import type { LogLine } from "../http/log.ts";
import { upgradeWebSocket } from "../runtime/node.ts";
import { openSqlite } from "../storage/sqlite.ts";
import { genesis } from "./group.ts";

export const ADMIN_TOKEN = "admin-token-for-tests-0123456789abcdef";

/** An app wired for tests, with a controllable clock and captured logs. */
export function testApp(overrides: Partial<Config> = {}, storage = openSqlite(":memory:")) {
  const logs: LogLine[] = [];
  const clock = { now: 1_793_232_000_000 };
  const config = { ...loadConfig({ FLOW_SYNC_ADMIN_TOKEN: ADMIN_TOKEN }, true), ...overrides };
  const { app, hub } = createApp({
    config,
    storage,
    log: (line) => logs.push(line),
    now: () => clock.now,
    clientIp: (c) => c.req.header("x-test-ip"),
    upgradeWebSocket,
  });
  return { app, hub, logs, clock, config, storage };
}

export function postJson(body: unknown, token?: string): RequestInit {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  return { method: "POST", headers, body: JSON.stringify(body) };
}

export const bearer = (token: string): RequestInit => ({
  headers: { authorization: `Bearer ${token}` },
});

/** An instance already claimed by a fresh group, plus that group's keys. */
export async function claimedApp(overrides: Partial<Config> = {}) {
  const harness = testApp(overrides);
  const fixture = await genesis();
  const res = await harness.app.request(
    "/v1/claim",
    postJson({ entry: fixture.entry, wraps: fixture.wraps }, ADMIN_TOKEN),
  );
  if (res.status !== 201) throw new Error(`claim failed: ${res.status}`);
  return { ...harness, ...fixture };
}
