import { DatabaseSync } from "node:sqlite";
import { equalBytes } from "@flow-sync/protocol";
import type { BlobStore, Change, MetaStore, ObjectRecord, PutResult, Storage } from "./types.ts";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS roster (seq INTEGER PRIMARY KEY, hash TEXT NOT NULL, entry TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS keys (epoch INTEGER NOT NULL, name TEXT NOT NULL, data BLOB NOT NULL,
  PRIMARY KEY (epoch, name));
CREATE TABLE IF NOT EXISTS objects (cursor INTEGER PRIMARY KEY AUTOINCREMENT, path TEXT NOT NULL UNIQUE,
  did TEXT NOT NULL, hash TEXT NOT NULL, size INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS objects_hash ON objects (hash);
CREATE TABLE IF NOT EXISTS blobs (hash TEXT PRIMARY KEY, data BLOB NOT NULL);
CREATE TABLE IF NOT EXISTS devices (did TEXT PRIMARY KEY, seen INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS challenges (id TEXT PRIMARY KEY, did TEXT NOT NULL, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS slots (slot TEXT PRIMARY KEY, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS pair_messages (slot TEXT NOT NULL, name TEXT NOT NULL, data BLOB NOT NULL,
  PRIMARY KEY (slot, name));
`;

const GROUP_TABLES = [
  "roster",
  "keys",
  "objects",
  "blobs",
  "devices",
  "challenges",
  "slots",
  "pair_messages",
];

type Row = Record<string, unknown>;

/** Opens (or creates) a database file; `:memory:` works for tests. */
export function openSqlite(path: string): Storage {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
  db.exec(SCHEMA);

  const one = (sql: string, ...params: (string | number | Uint8Array)[]) =>
    db.prepare(sql).get(...params) as Row | undefined;
  const run = (sql: string, ...params: (string | number | Uint8Array)[]) =>
    db.prepare(sql).run(...params);

  function transaction<T>(body: () => T): T {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = body();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  function putImmutable(existing: Row | undefined, same: boolean, insert: () => void): PutResult {
    if (existing) return same ? "identical" : "conflict";
    insert();
    return "created";
  }

  const meta: MetaStore = {
    async getSetting(key) {
      return one("SELECT value FROM settings WHERE key = ?", key)?.value as string | undefined;
    },
    async setSettingOnce(key, value) {
      return (
        run("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)", key, value).changes === 1
      );
    },
    async reset(keep) {
      transaction(() => {
        for (const table of GROUP_TABLES) run(`DELETE FROM ${table}`);
        const placeholders = keep.map(() => "?").join(",");
        run(`DELETE FROM settings WHERE key NOT IN (${placeholders})`, ...keep);
      });
    },

    async rosterAfter(seq, limit) {
      const rows = db
        .prepare("SELECT entry FROM roster WHERE seq > ? ORDER BY seq LIMIT ?")
        .all(seq, limit);
      return rows.map((row) => (row as Row).entry as string);
    },
    async appendRoster(append) {
      return transaction(() => {
        const head = one("SELECT seq, hash FROM roster ORDER BY seq DESC LIMIT 1");
        const expected =
          append.prev === undefined ? undefined : { seq: append.seq - 1, hash: append.prev };
        if (head?.seq !== expected?.seq || head?.hash !== expected?.hash) return false;
        run(
          "INSERT INTO roster (seq, hash, entry) VALUES (?, ?, ?)",
          append.seq,
          append.hash,
          append.entry,
        );
        for (const key of append.keys) {
          run(
            "INSERT INTO keys (epoch, name, data) VALUES (?, ?, ?)",
            key.epoch,
            key.name,
            key.data,
          );
        }
        return true;
      });
    },
    async getKey(epoch, name) {
      return one("SELECT data FROM keys WHERE epoch = ? AND name = ?", epoch, name)?.data as
        | Uint8Array
        | undefined;
    },

    async putObject(record) {
      return transaction(() => {
        const existing = one("SELECT hash FROM objects WHERE path = ?", record.path);
        return putImmutable(existing, existing?.hash === record.hash, () =>
          run(
            "INSERT INTO objects (path, did, hash, size) VALUES (?, ?, ?, ?)",
            record.path,
            record.did,
            record.hash,
            record.size,
          ),
        );
      });
    },
    async getObject(path) {
      return one("SELECT path, did, hash, size FROM objects WHERE path = ?", path) as
        | ObjectRecord
        | undefined;
    },
    async deleteObject(path) {
      return one("DELETE FROM objects WHERE path = ? RETURNING path, did, hash, size", path) as
        | ObjectRecord
        | undefined;
    },
    async isHashUsed(hash) {
      return one("SELECT 1 AS used FROM objects WHERE hash = ? LIMIT 1", hash) !== undefined;
    },
    async changesAfter(cursor, limit) {
      const sql = "SELECT cursor, path, size FROM objects WHERE cursor > ? ORDER BY cursor LIMIT ?";
      return db.prepare(sql).all(cursor, limit) as unknown as Change[];
    },
    async usage() {
      const row = one("SELECT COALESCE(SUM(size), 0) AS bytes, COUNT(*) AS objects FROM objects");
      return { bytes: row?.bytes as number, objects: row?.objects as number };
    },

    async touchDevice(did, at) {
      run(
        "INSERT INTO devices (did, seen) VALUES (?, ?) ON CONFLICT (did) DO UPDATE SET seen = excluded.seen",
        did,
        at,
      );
    },
    async devices() {
      const rows = db.prepare("SELECT did, seen FROM devices ORDER BY did").all() as Row[];
      return Object.fromEntries(rows.map((row) => [row.did as string, row.seen as number]));
    },

    async putChallenge(id, did, expires) {
      run("INSERT INTO challenges (id, did, expires) VALUES (?, ?, ?)", id, did, expires);
    },
    async takeChallenge(id) {
      return one("DELETE FROM challenges WHERE id = ? RETURNING did, expires", id) as
        | { did: string; expires: number }
        | undefined;
    },

    async openSlot(slot, expires, max, now) {
      return transaction(() => {
        const open = one("SELECT COUNT(*) AS n FROM slots WHERE expires > ?", now)?.n as number;
        if (open >= max) return false;
        return (
          run("INSERT OR IGNORE INTO slots (slot, expires) VALUES (?, ?)", slot, expires)
            .changes === 1
        );
      });
    },
    async slotExpiry(slot) {
      return one("SELECT expires FROM slots WHERE slot = ?", slot)?.expires as number | undefined;
    },
    async putPairMessage(slot, name, data) {
      return transaction(() => {
        const existing = one(
          "SELECT data FROM pair_messages WHERE slot = ? AND name = ?",
          slot,
          name,
        );
        const same = existing !== undefined && equalBytes(existing.data as Uint8Array, data);
        return putImmutable(existing, same, () =>
          run("INSERT INTO pair_messages (slot, name, data) VALUES (?, ?, ?)", slot, name, data),
        );
      });
    },
    async getPairMessage(slot, name) {
      return one("SELECT data FROM pair_messages WHERE slot = ? AND name = ?", slot, name)?.data as
        | Uint8Array
        | undefined;
    },
    async deleteSlot(slot) {
      transaction(() => {
        run("DELETE FROM pair_messages WHERE slot = ?", slot);
        run("DELETE FROM slots WHERE slot = ?", slot);
      });
    },
    async purgeExpired(now) {
      transaction(() => {
        run("DELETE FROM challenges WHERE expires <= ?", now);
        run(
          "DELETE FROM pair_messages WHERE slot IN (SELECT slot FROM slots WHERE expires <= ?)",
          now,
        );
        run("DELETE FROM slots WHERE expires <= ?", now);
      });
    },
  };

  const blobs: BlobStore = {
    async put(hash, data) {
      run("INSERT OR IGNORE INTO blobs (hash, data) VALUES (?, ?)", hash, data);
    },
    async get(hash) {
      return one("SELECT data FROM blobs WHERE hash = ?", hash)?.data as Uint8Array | undefined;
    },
    async delete(hash) {
      run("DELETE FROM blobs WHERE hash = ?", hash);
    },
  };

  return { meta, blobs };
}
