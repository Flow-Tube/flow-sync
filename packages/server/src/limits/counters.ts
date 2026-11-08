/** Bounds memory under a flood of distinct keys; the oldest entries are dropped first. */
const MAX_KEYS = 100_000;
const SWEEP_MS = 60_000;

/** Keys (device ids or IP addresses) stay in memory only, and only until their entry expires. */
class ExpiringMap<V extends { expires: number }> {
  readonly #entries = new Map<string, V>();
  #nextSweep = 0;

  get size(): number {
    return this.#entries.size;
  }

  get(key: string, now: number): V | undefined {
    const entry = this.#entries.get(key);
    return entry && entry.expires > now ? entry : undefined;
  }

  set(key: string, value: V, now: number): void {
    if (now >= this.#nextSweep) {
      for (const [k, entry] of this.#entries) if (entry.expires <= now) this.#entries.delete(k);
      this.#nextSweep = now + SWEEP_MS;
    }
    this.#entries.delete(key);
    this.#entries.set(key, value);
    if (this.#entries.size > MAX_KEYS)
      this.#entries.delete(this.#entries.keys().next().value as string);
  }
}

/** Fixed-window request counter. */
export class RateLimiter {
  readonly #windows = new ExpiringMap<{ expires: number; count: number }>();
  readonly #limit: number;
  readonly #windowMs: number;

  constructor(limit: number, windowMs: number) {
    this.#limit = limit;
    this.#windowMs = windowMs;
  }

  get tracked(): number {
    return this.#windows.size;
  }

  /** Returns the seconds to wait, or 0 when the request is allowed. */
  take(key: string, now: number): number {
    const window = this.#windows.get(key, now) ?? { expires: now + this.#windowMs, count: 0 };
    window.count += 1;
    this.#windows.set(key, window, now);
    return window.count > this.#limit ? Math.ceil((window.expires - now) / 1000) : 0;
  }
}

/**
 * Counts failures per key. A key that stops failing for `windowMs` starts over. From `backoffFrom`
 * failures on, each one makes the key wait twice as long, and `limit` failures ban it for `windowMs`.
 */
export class FailureBans {
  readonly #failures = new ExpiringMap<{ expires: number; count: number; until: number }>();
  readonly #limit: number;
  readonly #windowMs: number;
  readonly #backoffFrom: number;

  constructor(limit: number, windowMs: number, backoffFrom = limit) {
    this.#limit = limit;
    this.#windowMs = windowMs;
    this.#backoffFrom = backoffFrom;
  }

  get tracked(): number {
    return this.#failures.size;
  }

  /** Returns the seconds left on a wait or a ban, or 0. */
  bannedFor(key: string, now: number): number {
    const until = this.#failures.get(key, now)?.until ?? 0;
    return until > now ? Math.ceil((until - now) / 1000) : 0;
  }

  fail(key: string, now: number): void {
    const count = (this.#failures.get(key, now)?.count ?? 0) + 1;
    this.#failures.set(
      key,
      { expires: now + this.#windowMs, count, until: now + this.#wait(count) },
      now,
    );
  }

  #wait(count: number): number {
    if (count >= this.#limit) return this.#windowMs;
    return count >= this.#backoffFrom ? 1000 * 2 ** (count - this.#backoffFrom) : 0;
  }
}
