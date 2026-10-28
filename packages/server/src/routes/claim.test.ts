import { describe, expect, test } from "vitest";
import { ADMIN_TOKEN, postJson, testApp } from "../testing/app.ts";

const adminJson = (body: unknown, token = ADMIN_TOKEN) => postJson(body, token);

import { genesis } from "../testing/group.ts";

const info = async (app: ReturnType<typeof testApp>["app"]) =>
  ((await (await app.request("/v1/info")).json()) as { claimed: boolean }).claimed;

describe("claim", () => {
  test("the admin token claims an unclaimed instance once", async () => {
    const { app } = testApp();
    const { entry, wraps } = await genesis();
    expect(await info(app)).toBe(false);
    expect((await app.request("/v1/claim", adminJson({ entry, wraps }))).status).toBe(201);
    expect(await info(app)).toBe(true);
    const again = await genesis();
    const res = await app.request(
      "/v1/claim",
      adminJson({ entry: again.entry, wraps: again.wraps }),
    );
    expect(res.status).toBe(409);
  });

  test("a wrong or missing admin token is refused", async () => {
    const { app } = testApp();
    const { entry, wraps } = await genesis();
    expect((await app.request("/v1/claim", adminJson({ entry, wraps }, "wrong"))).status).toBe(401);
    const noAuth = adminJson({ entry, wraps });
    noAuth.headers = { "content-type": "application/json" };
    expect((await app.request("/v1/claim", noAuth)).status).toBe(401);
  });

  test("claiming is impossible when admin access is off", async () => {
    const { app } = testApp({ adminTokenHash: undefined });
    const { entry, wraps } = await genesis();
    expect((await app.request("/v1/claim", adminJson({ entry, wraps }))).status).toBe(401);
  });

  test("the genesis entry and its wraps are validated", async () => {
    const { app } = testApp();
    const { entry, wraps } = await genesis();
    const [first] = Object.keys(wraps);
    const missing = { ...wraps };
    delete missing[first as string];
    const cases = [
      { entry, wraps: missing },
      { entry, wraps: { ...wraps, [first as string]: "AAAA" } },
      { entry: { ...entry, seq: 1 }, wraps },
      { entry: { ...entry, sigs: {} }, wraps },
      { entry: "not an entry", wraps },
    ];
    for (const body of cases) {
      const res = await app.request("/v1/claim", adminJson(body));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid" });
    }
    expect(await info(app)).toBe(false);
  });

  test("bodies must be JSON and within the size limit", async () => {
    const { app } = testApp();
    const text = {
      ...adminJson({}),
      headers: { authorization: `Bearer ${ADMIN_TOKEN}`, "content-type": "text/plain" },
    };
    expect((await app.request("/v1/claim", text)).status).toBe(415);
    const huge = adminJson({ entry: "x".repeat(70 * 1024), wraps: {} });
    expect((await app.request("/v1/claim", huge)).status).toBe(413);
  });
});
