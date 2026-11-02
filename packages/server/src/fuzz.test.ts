import { blobPath, logPath, randomBytes, toHex } from "@flow-sync/protocol";
import { fuzzRuns, mutations } from "@flow-sync/protocol/testing";
import fc from "fast-check";
import { expect, test } from "vitest";
import type { ErrorCode } from "./http/errors.ts";
import { claimedApp, testApp } from "./testing/app.ts";
import { signIn } from "./testing/group.ts";
import { ADMIN_TOKEN } from "./testing/http.ts";
import { sealedObject } from "./testing/objects.ts";

type Body = string | Uint8Array | undefined;
type Credential = "none" | "device" | "admin";

interface Target {
  request: (path: string, init: RequestInit) => Response | Promise<Response>;
  token: (credential: Credential) => string | undefined;
  did: string;
}

const CLIENT_ERRORS: ErrorCode[] = [
  "invalid",
  "unauthorized",
  "forbidden",
  "not_found",
  "conflict",
  "declined",
  "too_large",
  "unsupported",
  "rate_limited",
  "unclaimed",
  "quota",
];

const hex = (bytes: number) => fc.uint8Array({ minLength: bytes, maxLength: bytes }).map(toHex);
const segment = fc.oneof(
  fc.string().map(encodeURIComponent),
  hex(16),
  hex(32),
  fc.constantFrom("..", "%2e%2e", "%2F", "chain.k", "a-0000000000000001.p", "00000000.k"),
);
const route = fc.constantFrom(
  "/",
  "/v1/health",
  "/v1/info",
  "/v1/claim",
  "/v1/auth/challenge",
  "/v1/auth/token",
  "/v1/roster",
  "/v1/keys",
  "/v1/objects/dev",
  "/v1/changes",
  "/v1/pair",
  "/v1/join",
  "/v1/status",
  "/v1/admin/usage",
  "/v1/admin/reset",
  "/v1/live",
  "/.well-known/security.txt",
);
const path = fc
  .tuple(route, fc.oneof(fc.constant([]), fc.array(segment, { maxLength: 4 })))
  .map(([base, rest]) => [base, ...rest].join("/").replace("//", "/"));
const query = fc
  .array(fc.tuple(fc.constantFrom("after", "cursor", "limit", "x"), fc.string()), { maxLength: 3 })
  .map((pairs) => (pairs.length ? `?${new URLSearchParams(pairs)}` : ""));
const deepJson = fc.nat(5000).map((depth) => "[".repeat(depth) + "]".repeat(depth));
const json = fc.oneof(fc.json(), deepJson);
const contentType = fc.constantFrom(
  undefined,
  "application/json",
  "application/octet-stream",
  "application/json; charset=utf-8",
  "text/plain",
);

const JSON_TYPE = "application/json";
const BYTES = "application/octet-stream";

/** Real endpoints with well-formed parameters, so most requests reach the body parsers. */
function endpoints(did: fc.Arbitrary<string>) {
  const seq = fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER });
  const log = fc.tuple(did, seq).map(([d, n]) => `/v1/objects/${logPath(d, n)}`);
  const blob = fc.tuple(did, hex(32)).map(([d, h]) => `/v1/objects/${blobPath(d, h)}`);
  const message = fc
    .tuple(hex(16), fc.constantFrom("a", "b"), hex(8))
    .map(([slot, dir, n]) => `/v1/pair/${slot}/${dir}-${n}.p`);
  const key = fc
    .tuple(hex(4), fc.oneof(did, fc.constant("chain")))
    .map(([e, n]) => `/v1/keys/${e}/${n}.k`);
  const shape = (method: string, path: fc.Arbitrary<string>, type?: string) =>
    path.map((p) => ({ method, path: p, type }));
  return fc.oneof(
    ...[
      "/v1/claim",
      "/v1/auth/challenge",
      "/v1/auth/token",
      "/v1/roster",
      "/v1/pair",
      "/v1/join",
      "/v1/admin/reset",
    ].map((p) => shape("POST", fc.constant(p), JSON_TYPE)),
    shape(
      "GET",
      fc.tuple(fc.constantFrom("/v1/roster", "/v1/changes"), query).map(([p, q]) => p + q),
    ),
    shape("GET", key),
    ...["PUT", "GET", "DELETE"].map((m) => shape(m, fc.oneof(log, blob), BYTES)),
    ...["PUT", "GET"].map((m) => shape(m, message, BYTES)),
    shape(
      "DELETE",
      hex(16).map((slot) => `/v1/pair/${slot}`),
    ),
    ...["PUT", "GET", "DELETE"].map((m) =>
      shape(
        m,
        hex(16).map((id) => `/v1/join/${id}`),
        JSON_TYPE,
      ),
    ),
  );
}

/** Sends arbitrary requests and returns how often each status came back. */
async function fuzz(target: Target, body: fc.Arbitrary<Body>) {
  const statuses: Record<number, number> = {};
  let ip = 0;
  const anything = fc.record({
    method: fc.constantFrom("GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"),
    path: fc.tuple(path, query).map(([p, q]) => p + q),
    type: contentType,
  });
  const did = fc.oneof(hex(16), fc.constant(target.did));
  const request = fc.record({
    call: fc.oneof({ weight: 3, arbitrary: endpoints(did) }, anything),
    auth: fc.oneof(
      { weight: 3, arbitrary: fc.constantFrom<Credential>("none", "device", "admin") },
      fc.string(),
    ),
    body,
  });
  await fc.assert(
    fc.asyncProperty(request, async ({ call: { method, path, type }, auth, body }) => {
      // A new address per request keeps bans for failed sign-ins out of the way.
      const headers: Record<string, string> = { "x-test-ip": String(ip++) };
      const known = auth === "none" || auth === "device" || auth === "admin";
      const token = known ? target.token(auth) : auth;
      if (token !== undefined) headers.authorization = `Bearer ${token}`;
      if (type) headers["content-type"] = type;
      const init: RequestInit = { method, headers };
      if (body !== undefined && method !== "GET" && method !== "OPTIONS") {
        init.body = typeof body === "string" ? body : new Uint8Array(body);
      }
      const res = await target.request(path, init);
      statuses[res.status] = (statuses[res.status] ?? 0) + 1;
      expect(res.status).not.toBe(500);
      if (res.status >= 400) {
        expect(CLIENT_ERRORS).toContain(((await res.json()) as { error: ErrorCode }).error);
      }
    }),
    fuzzRuns(),
  );
  return statuses;
}

test("arbitrary requests to an unclaimed instance never fail inside the server", async () => {
  const { app } = testApp();
  const body = fc.oneof(fc.constant(undefined), json, fc.uint8Array({ maxLength: 2048 }));
  await fuzz(
    {
      request: (path, init) => app.request(path, init),
      token: (c) => (c === "none" ? undefined : ADMIN_TOKEN),
      did: toHex(randomBytes(16)),
    },
    body,
  );
});

test("arbitrary requests to a claimed instance never fail inside the server or log tokens", async () => {
  const h = await claimedApp();
  const object = sealedObject(h.device, 1, { group: h.group, epochKey: h.epochKey });
  const body = fc.oneof(
    fc.constant(undefined),
    json,
    fc
      .jsonValue()
      .map((entry) => JSON.stringify({ entry, wraps: {}, slot: toHex(randomBytes(16)) })),
    mutations(object),
  );
  const tokens = [await signIn(h.app, h.device, h.group)];
  let issued = h.clock.now;
  const target: Target = {
    // Each request moves the clock past the per-device rate; tokens are renewed before they expire.
    request: async (path, init) => {
      h.clock.now += 101;
      if (h.clock.now - issued > 10 * 60_000) {
        tokens.push(await signIn(h.app, h.device, h.group));
        issued = h.clock.now;
      }
      return h.app.request(path, init);
    },
    token: (c) => (c === "device" ? tokens.at(-1) : c === "admin" ? ADMIN_TOKEN : undefined),
    did: toHex(h.device.did),
  };
  const statuses = await fuzz(target, body);
  // Enough requests got past routing and authentication to reach the body checks.
  expect(statuses[400]).toBeGreaterThan(0);
  const logged = JSON.stringify(h.logs);
  for (const token of [...tokens, ADMIN_TOKEN]) expect(logged).not.toContain(token);
});
