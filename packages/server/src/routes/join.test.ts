import { randomBytes, toHex } from "@flow-sync/protocol";
import { describe, expect, test } from "vitest";
import { LIMITS } from "../limits.ts";
import { ADMIN_TOKEN, bearer, claimedApp, postJson } from "../testing/app.ts";
import { signIn } from "../testing/group.ts";

type Listed = { requests: { id: string; name: string; expires: number }[] };

const answer = (code: string, token: string): RequestInit => ({
  ...postJson({ code }, token),
  method: "PUT",
});

async function setup() {
  const h = await claimedApp();
  const token = await signIn(h.app, h.device, h.group);
  const id = toHex(randomBytes(16));
  const ask = (requestId = id) =>
    h.app.request("/v1/join", postJson({ id: requestId, name: "Pixel" }, ADMIN_TOKEN));
  return { ...h, token, id, ask };
}

describe("join requests", () => {
  test("a new device asks with the admin token and picks up the code a member posts", async () => {
    const h = await setup();
    expect((await h.ask()).status).toBe(201);
    expect((await h.ask()).status).toBe(409);
    const listed = (await (await h.app.request("/v1/join", bearer(h.token))).json()) as Listed;
    expect(listed.requests).toEqual([{ id: h.id, name: "Pixel", expires: expect.any(Number) }]);
    expect((await h.app.request(`/v1/join/${h.id}`, bearer(ADMIN_TOKEN))).status).toBe(404);

    expect((await h.app.request(`/v1/join/${h.id}`, answer('{"v":2}', h.token))).status).toBe(201);
    expect((await h.app.request(`/v1/join/${h.id}`, answer('{"v":2}', h.token))).status).toBe(409);
    const picked = await h.app.request(`/v1/join/${h.id}`, bearer(ADMIN_TOKEN));
    expect(await picked.json()).toEqual({ code: '{"v":2}' });
    const after = (await (await h.app.request("/v1/join", bearer(h.token))).json()) as Listed;
    expect(after.requests).toEqual([]);
  });

  test("asking needs the admin token, answering needs a member", async () => {
    const h = await setup();
    const wrong = await h.app.request(
      "/v1/join",
      postJson({ id: h.id, name: "Pixel" }, "not-the-admin-token"),
    );
    expect(wrong.status).toBe(401);
    await h.ask();
    expect((await h.app.request("/v1/join", bearer(ADMIN_TOKEN))).status).toBe(401);
    expect((await h.app.request(`/v1/join/${h.id}`, answer("code", ADMIN_TOKEN))).status).toBe(401);
    expect((await h.app.request(`/v1/join/${h.id}`, bearer(h.token))).status).toBe(401);
    expect(
      (await h.app.request(`/v1/join/${toHex(randomBytes(16))}`, answer("code", h.token))).status,
    ).toBe(404);
  });

  test("requests are bounded and a member can decline one", async () => {
    const h = await setup();
    for (let i = 0; i < LIMITS.joinRequests; i++)
      expect((await h.ask(toHex(randomBytes(16)))).status).toBe(201);
    expect((await h.ask()).status).toBe(409);
    const tooLong = postJson({ id: h.id, name: "x".repeat(LIMITS.joinName + 1) }, ADMIN_TOKEN);
    expect((await h.app.request("/v1/join", tooLong)).status).toBe(400);
    const { requests } = (await (
      await h.app.request("/v1/join", bearer(h.token))
    ).json()) as Listed;
    const del = await h.app.request(`/v1/join/${requests[0]?.id}`, {
      ...bearer(h.token),
      method: "DELETE",
    });
    expect(del.status).toBe(204);
    expect((await h.ask()).status).toBe(201);
  });

  test("a declined request tells the waiting device until it expires", async () => {
    const h = await setup();
    await h.ask();
    const decline = () =>
      h.app.request(`/v1/join/${h.id}`, { ...bearer(h.token), method: "DELETE" });
    expect((await decline()).status).toBe(204);
    expect((await decline()).status).toBe(409);
    expect((await h.app.request(`/v1/join/${h.id}`, answer("code", h.token))).status).toBe(409);
    const listed = (await (await h.app.request("/v1/join", bearer(h.token))).json()) as Listed;
    expect(listed.requests).toEqual([]);
    const waiting = await h.app.request(`/v1/join/${h.id}`, bearer(ADMIN_TOKEN));
    expect(waiting.status).toBe(410);
    expect(await waiting.json()).toEqual({ error: "declined" });
    h.clock.now += LIMITS.pairMs;
    expect((await h.app.request(`/v1/join/${h.id}`, bearer(ADMIN_TOKEN))).status).toBe(404);
    expect((await decline()).status).toBe(404);
  });
});
