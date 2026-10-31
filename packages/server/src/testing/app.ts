import { createApp } from "../app.ts";
import { type Config, loadConfig } from "../config.ts";
import type { LogLine } from "../http/log.ts";
import { nodeLive } from "../runtime/node.ts";
import { openSqlite } from "../storage/sqlite.ts";
import { claim } from "./group.ts";
import { ADMIN_TOKEN } from "./http.ts";

/** An app wired for tests, with a controllable clock and captured logs. */
export function testApp(overrides: Partial<Config> = {}, storage = openSqlite(":memory:")) {
  const logs: LogLine[] = [];
  const clock = { now: 1_793_232_000_000 };
  const config = { ...loadConfig({ FLOW_SYNC_ADMIN_TOKEN: ADMIN_TOKEN }, true), ...overrides };
  const { app, relay } = createApp({
    config,
    storage,
    log: (line) => logs.push(line),
    now: () => clock.now,
    clientIp: (c) => c.req.header("x-test-ip"),
    live: nodeLive,
  });
  return { app, relay, logs, clock, config, storage };
}

/** An instance already claimed by a fresh group, plus that group's keys. */
export async function claimedApp(overrides: Partial<Config> = {}) {
  const harness = testApp(overrides);
  return { ...harness, ...(await claim(harness.app)) };
}
