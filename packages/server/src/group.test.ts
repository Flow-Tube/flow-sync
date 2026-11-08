import { expect, test } from "vitest";
import { claimedApp, testApp } from "./testing/app.ts";
import { signIn } from "./testing/group.ts";
import { bearer } from "./testing/http.ts";

test("instance settings are read again after a storage failure", async () => {
  const h = await claimedApp();
  const token = await signIn(h.app, h.device, h.group);
  let failures = 1;
  const meta = {
    ...h.storage.meta,
    setSettingOnce: (key: string, value: string) =>
      failures-- > 0
        ? Promise.reject(new Error("storage down"))
        : h.storage.meta.setSettingOnce(key, value),
  };
  const { app } = testApp({}, { ...h.storage, meta });
  expect((await app.request("/v1/status", bearer(token))).status).toBe(500);
  expect((await app.request("/v1/status", bearer(token))).status).toBe(200);
});
