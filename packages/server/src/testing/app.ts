import { createApp } from "../app.ts";
import { type Config, loadConfig } from "../config.ts";
import type { LogLine } from "../http/log.ts";
import { openSqlite } from "../storage/sqlite.ts";

export const ADMIN_TOKEN = "admin-token-for-tests-0123456789abcdef";

/** An app wired for tests, with a controllable clock and captured logs. */
export function testApp(overrides: Partial<Config> = {}) {
  const logs: LogLine[] = [];
  const clock = { now: 1_793_232_000_000 };
  const config = { ...loadConfig({ FLOW_SYNC_ADMIN_TOKEN: ADMIN_TOKEN }, true), ...overrides };
  const storage = openSqlite(":memory:");
  const app = createApp({ config, storage, log: (line) => logs.push(line), now: () => clock.now });
  return { app, logs, clock, config, storage };
}

export function adminJson(body: unknown, token = ADMIN_TOKEN): RequestInit {
  return {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}
