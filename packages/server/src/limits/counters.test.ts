import { expect, test } from "vitest";
import { FailureBans, RateLimiter } from "./counters.ts";

test("a rate limiter allows its limit per window and says how long to wait", () => {
  const limiter = new RateLimiter(2, 60_000);
  expect(limiter.take("a", 0)).toBe(0);
  expect(limiter.take("a", 1)).toBe(0);
  expect(limiter.take("a", 10_000)).toBe(50);
  expect(limiter.take("b", 10_000)).toBe(0);
  expect(limiter.take("a", 60_000)).toBe(0);
});

test("failures ban a key once they reach the limit, until the ban ends", () => {
  const bans = new FailureBans(3, 900_000);
  bans.fail("ip", 0);
  bans.fail("ip", 1);
  expect(bans.bannedFor("ip", 2)).toBe(0);
  bans.fail("ip", 2);
  expect(bans.bannedFor("ip", 2)).toBe(900);
  expect(bans.bannedFor("ip", 900_002)).toBe(0);
  bans.fail("ip", 900_003);
  expect(bans.bannedFor("ip", 900_003)).toBe(0);
});
