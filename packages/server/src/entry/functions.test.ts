import { describe, expect, test, vi } from "vitest";
import { LIMITS } from "../limits.ts";

type Fetch = (request: Request) => Response | Promise<Response>;

/** Vercel caps request and response bodies at 4.5 MB; Netlify buffers base64 up to 6 MB. */
const VERCEL_BODY = 4_500_000;
const NETLIFY_BUFFERED = 6_000_000;
const HEADROOM = 64 * 1024;

test("the largest object fits every function host's body limits", () => {
  expect(LIMITS.object + HEADROOM).toBeLessThan(VERCEL_BODY);
  expect(Math.ceil(LIMITS.object / 3) * 4 + HEADROOM).toBeLessThan(NETLIFY_BUFFERED);
});

// Neither request below reaches the database, so an unreachable URL is enough.
vi.stubEnv("DATABASE_URL", "postgres://flow-sync@127.0.0.1:1/flow-sync");

const entries: Record<string, () => Promise<Fetch>> = {
  vercel: async () => {
    const app = (await import("./vercel.ts")).default;
    return (request) => app.fetch(request);
  },
  netlify: async () => (await import("./netlify.ts")).default,
};

describe.each(Object.entries(entries))("%s entry", (_name, load) => {
  test("serves the API with live features off", async () => {
    const fetch = await load();
    expect((await fetch(new Request("https://flow-sync.test/v1/health"))).status).toBe(200);
    expect((await fetch(new Request("https://flow-sync.test/v1/live"))).status).toBe(404);
  });
});
