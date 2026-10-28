/** Bounds memory under a flood of distinct keys; the oldest entries are dropped first. */
const MAX_KEYS = 100_000;

function bounded<V>(map: Map<string, V>, key: string, value: V): void {
  map.delete(key);
  map.set(key, value);
  if (map.size > MAX_KEYS) map.delete(map.keys().next().value as string);
}

/** Fixed-window request counter. Keys (device ids or IP addresses) live only in memory. */
export class RateLimiter {
  readonly #windows = new Map<string, { start: number; count: number }>();
  readonly #limit: number;
  readonly #windowMs: number;

  constructor(limit: number, windowMs: number) {
    this.#limit = limit;
    this.#windowMs = windowMs;
  }

  /** Returns the seconds to wait, or 0 when the request is allowed. */
  take(key: string, now: number): number {
    const current = this.#windows.get(key);
    const window =
      current && now - current.start < this.#windowMs ? current : { start: now, count: 0 };
    window.count += 1;
    bounded(this.#windows, key, window);
    return window.count > this.#limit ? Math.ceil((window.start + this.#windowMs - now) / 1000) : 0;
  }
}

/** Counts failures per key and bans the key for a while once it reaches the limit. */
export class FailureBans {
  readonly #failures = new Map<string, { count: number; until: number }>();
  readonly #limit: number;
  readonly #banMs: number;

  constructor(limit: number, banMs: number) {
    this.#limit = limit;
    this.#banMs = banMs;
  }

  /** Returns the seconds left on a ban, or 0. */
  bannedFor(key: string, now: number): number {
    const entry = this.#failures.get(key);
    return entry && entry.until > now ? Math.ceil((entry.until - now) / 1000) : 0;
  }

  fail(key: string, now: number): void {
    const entry = this.#failures.get(key) ?? { count: 0, until: 0 };
    if (entry.until && entry.until <= now) entry.count = 0;
    entry.count += 1;
    entry.until = entry.count >= this.#limit ? now + this.#banMs : 0;
    bounded(this.#failures, key, entry);
  }
}
