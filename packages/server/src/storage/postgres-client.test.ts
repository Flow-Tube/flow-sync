import { EventEmitter } from "node:events";
import pg from "pg";
import { expect, test } from "vitest";
import { openPostgres } from "./postgres.ts";

/** Answers every query, and loses its connection during the transaction's lock. */
class LosingClient extends EventEmitter {
  static thrown: unknown[] = [];
  static ended = 0;
  _queryable = true;
  _ending = false;
  connect(done: (error?: Error) => void) {
    done();
  }
  end(done?: () => void) {
    LosingClient.ended += 1;
    done?.();
  }
  query(text: string, _values?: unknown, done?: (error: undefined, result: unknown) => void) {
    if (text.startsWith("SELECT pg_advisory_xact_lock")) {
      try {
        this.emit("error", new Error("connection lost"));
      } catch (error) {
        LosingClient.thrown.push(error);
      }
    }
    if (done) return done(undefined, { rows: [] });
    return Promise.resolve({ rows: [] });
  }
}

test("a connection lost during a transaction stays with that client, which leaves the pool", async () => {
  const pool = new pg.Pool({ Client: LosingClient as never });
  await openPostgres(pool)
    .meta.rosterAfter(-1, 1)
    .catch(() => {});
  expect(LosingClient.thrown).toEqual([]);
  expect(LosingClient.ended).toBe(1);
  await pool.end();
});
