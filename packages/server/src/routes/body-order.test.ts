import { expect, test } from "vitest";
import { claimedApp } from "../testing/app.ts";
import { objectUrl } from "../testing/objects.ts";

const CHUNK = 64 * 1024;

/** A body of unknown length that counts what is read of it. */
function countedBody(total: number) {
  const chunk = new Uint8Array(CHUNK);
  const counted = {
    read: 0,
    body: new ReadableStream<Uint8Array>({
      pull(controller) {
        if (counted.read >= total) return controller.close();
        counted.read += CHUNK;
        controller.enqueue(chunk);
      },
    }),
  };
  return counted;
}

test.each([
  ["PUT", "object", (h: Awaited<ReturnType<typeof claimedApp>>) => objectUrl(h.device, 1)],
  ["POST", "roster", () => "/v1/roster"],
  ["POST", "pairing slot", () => "/v1/pair"],
  ["POST", "join request", () => "/v1/join"],
  ["PUT", "join answer", () => `/v1/join/${"0".repeat(32)}`],
  ["POST", "claim", () => "/v1/claim"],
])("%s %s without a valid token is refused before its body is read", async (method, _name, url) => {
  const h = await claimedApp();
  const counted = countedBody(4 * 1024 * 1024);
  const res = await h.app.request(url(h), {
    method,
    headers: { authorization: "Bearer bad", "content-type": "application/octet-stream" },
    body: counted.body,
    duplex: "half",
  } as RequestInit);
  expect(res.status).toBe(401);
  expect(counted.read).toBeLessThanOrEqual(2 * CHUNK);
});
