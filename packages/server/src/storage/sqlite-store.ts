import type {
  BlobStore,
  Change,
  JoinRequest,
  MetaStore,
  ObjectRecord,
  PutResult,
  Storage,
} from "./types.ts";

export type SqlValue = string | number | Uint8Array | null;
export type Row = Record<string, unknown>;
export interface SqlStatement {
  sql: string;
  params: SqlValue[];
}
export interface SqlResult {
  rows: Row[];
  /** Rows written, for a statement that returns no rows. */
  changes: number;
}

/** A SQLite database (node:sqlite or D1). D1 has no interactive transactions, only batches. */
export interface SqliteDb {
  query(statement: SqlStatement): Promise<SqlResult>;
  /** Runs the statements in order, all or none. */
  batch(statements: SqlStatement[]): Promise<SqlResult[]>;
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS roster (seq INTEGER PRIMARY KEY, hash TEXT NOT NULL, entry TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS keys (epoch INTEGER NOT NULL, name TEXT NOT NULL, data BLOB NOT NULL,
  PRIMARY KEY (epoch, name))`,
  `CREATE TABLE IF NOT EXISTS objects (cursor INTEGER PRIMARY KEY AUTOINCREMENT, path TEXT NOT NULL UNIQUE,
  did TEXT NOT NULL, hash TEXT NOT NULL, size INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS objects_hash ON objects (hash)`,
  `CREATE TABLE IF NOT EXISTS blobs (hash TEXT PRIMARY KEY, data BLOB NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS devices (did TEXT PRIMARY KEY, seen INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS challenges (id TEXT PRIMARY KEY, did TEXT NOT NULL, expires INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS slots (slot TEXT PRIMARY KEY, expires INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS pair_messages (slot TEXT NOT NULL, name TEXT NOT NULL, data BLOB NOT NULL,
  PRIMARY KEY (slot, name))`,
  `CREATE TABLE IF NOT EXISTS join_requests (id TEXT PRIMARY KEY, name TEXT NOT NULL, expires INTEGER NOT NULL,
  code TEXT)`,
];

/** Columns added after their table shipped; adding them in place keeps existing rows. */
const ADDED_COLUMNS = [
  { table: "join_requests", column: "declined", type: "INTEGER NOT NULL DEFAULT 0" },
];

const UNANSWERED = "id = ? AND expires > ? AND code IS NULL AND declined = 0";

const GROUP_TABLES = [
  "roster",
  "keys",
  "objects",
  "devices",
  "challenges",
  "slots",
  "pair_messages",
  "join_requests",
];

const sql = (text: string, ...params: SqlValue[]): SqlStatement => ({ sql: text, params });

/** Creates the tables on first use. */
export function openSqliteStore(db: SqliteDb): Storage {
  let ready: Promise<void> | undefined;
  async function migrate(): Promise<void> {
    await db.batch(SCHEMA.map((statement) => sql(statement)));
    for (const { table, column, type } of ADDED_COLUMNS) {
      const exists = await db.query(
        sql("SELECT 1 FROM pragma_table_info(?) WHERE name = ?", table, column),
      );
      if (!exists.rows.length)
        await db.query(sql(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`));
    }
  }
  const schema = () =>
    (ready ??= migrate().catch((error) => {
      ready = undefined;
      throw error;
    }));

  const query = async (text: string, ...params: SqlValue[]) => {
    await schema();
    return db.query(sql(text, ...params));
  };
  const one = async (text: string, ...params: SqlValue[]) => (await query(text, ...params)).rows[0];
  const changed = async (text: string, ...params: SqlValue[]) =>
    (await query(text, ...params)).changes === 1;
  const batch = async (statements: SqlStatement[]) => {
    await schema();
    return db.batch(statements);
  };

  /** Rows are immutable once written, so a lost insert only needs to compare. */
  async function putImmutable(
    insert: SqlStatement,
    same: () => Promise<boolean>,
  ): Promise<PutResult> {
    if ((await query(insert.sql, ...insert.params)).changes === 1) return "created";
    return (await same()) ? "identical" : "conflict";
  }

  const meta: MetaStore = {
    async getSetting(key) {
      return (await one("SELECT value FROM settings WHERE key = ?", key))?.value as
        | string
        | undefined;
    },
    async setSettingOnce(key, value) {
      return changed("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)", key, value);
    },
    async reset(keep) {
      const placeholders = keep.map(() => "?").join(",");
      await batch([
        ...GROUP_TABLES.map((table) => sql(`DELETE FROM ${table}`)),
        sql(`DELETE FROM settings WHERE key NOT IN (${placeholders})`, ...keep),
      ]);
    },

    async rosterAfter(seq, limit) {
      const { rows } = await query(
        "SELECT entry FROM roster WHERE seq > ? ORDER BY seq LIMIT ?",
        seq,
        limit,
      );
      return rows.map((row) => row.entry as string);
    },
    async appendRoster(append) {
      const atHead =
        append.prev === undefined
          ? sql("NOT EXISTS (SELECT 1 FROM roster)")
          : sql(
              "EXISTS (SELECT 1 FROM roster WHERE seq = ? AND hash = ? AND seq = (SELECT MAX(seq) FROM roster))",
              append.seq - 1,
              append.prev,
            );
      const [inserted] = await batch([
        sql(
          `INSERT INTO roster (seq, hash, entry) SELECT ?, ?, ? WHERE ${atHead.sql}`,
          append.seq,
          append.hash,
          append.entry,
          ...atHead.params,
        ),
        // changes() is the row count of the insert before, so each key lands only after the entry.
        ...append.keys.map((key) =>
          sql(
            "INSERT INTO keys (epoch, name, data) SELECT ?, ?, ? WHERE changes() = 1",
            key.epoch,
            key.name,
            key.data,
          ),
        ),
      ]);
      return inserted?.changes === 1;
    },
    async getKey(epoch, name) {
      return (await one("SELECT data FROM keys WHERE epoch = ? AND name = ?", epoch, name))?.data as
        | Uint8Array
        | undefined;
    },

    async putObject(record) {
      return putImmutable(
        sql(
          "INSERT OR IGNORE INTO objects (path, did, hash, size) VALUES (?, ?, ?, ?)",
          record.path,
          record.did,
          record.hash,
          record.size,
        ),
        async () =>
          (await one("SELECT hash FROM objects WHERE path = ?", record.path))?.hash === record.hash,
      );
    },
    async getObject(path) {
      return (await one("SELECT path, did, hash, size FROM objects WHERE path = ?", path)) as
        | ObjectRecord
        | undefined;
    },
    async deleteObject(path) {
      return (await one(
        "DELETE FROM objects WHERE path = ? RETURNING path, did, hash, size",
        path,
      )) as ObjectRecord | undefined;
    },
    async isHashUsed(hash) {
      return (
        (await one("SELECT 1 AS used FROM objects WHERE hash = ? LIMIT 1", hash)) !== undefined
      );
    },
    async changesAfter(cursor, limit) {
      const { rows } = await query(
        "SELECT cursor, path, size FROM objects WHERE cursor > ? ORDER BY cursor LIMIT ?",
        cursor,
        limit,
      );
      return rows as unknown as Change[];
    },
    async usage() {
      const row = await one(
        "SELECT COALESCE(SUM(size), 0) AS bytes, COUNT(*) AS objects FROM objects",
      );
      return { bytes: row?.bytes as number, objects: row?.objects as number };
    },

    async touchDevice(did, at) {
      await query(
        "INSERT INTO devices (did, seen) VALUES (?, ?) ON CONFLICT (did) DO UPDATE SET seen = excluded.seen",
        did,
        at,
      );
    },
    async devices() {
      const { rows } = await query("SELECT did, seen FROM devices ORDER BY did");
      return Object.fromEntries(rows.map((row) => [row.did as string, row.seen as number]));
    },

    async putChallenge(id, did, expires) {
      await query("INSERT INTO challenges (id, did, expires) VALUES (?, ?, ?)", id, did, expires);
    },
    async takeChallenge(id) {
      return (await one("DELETE FROM challenges WHERE id = ? RETURNING did, expires", id)) as
        | { did: string; expires: number }
        | undefined;
    },

    async openSlot(slot, expires, max, now) {
      return changed(
        "INSERT OR IGNORE INTO slots (slot, expires) SELECT ?, ? WHERE (SELECT COUNT(*) FROM slots WHERE expires > ?) < ?",
        slot,
        expires,
        now,
        max,
      );
    },
    async slotExpiry(slot) {
      return (await one("SELECT expires FROM slots WHERE slot = ?", slot))?.expires as
        | number
        | undefined;
    },
    async putPairMessage(slot, name, data) {
      return putImmutable(
        sql(
          "INSERT OR IGNORE INTO pair_messages (slot, name, data) VALUES (?, ?, ?)",
          slot,
          name,
          data,
        ),
        async () =>
          (await one(
            "SELECT 1 AS same FROM pair_messages WHERE slot = ? AND name = ? AND data = ?",
            slot,
            name,
            data,
          )) !== undefined,
      );
    },
    async getPairMessage(slot, name) {
      return (await one("SELECT data FROM pair_messages WHERE slot = ? AND name = ?", slot, name))
        ?.data as Uint8Array | undefined;
    },
    async deleteSlot(slot) {
      await batch([
        sql("DELETE FROM pair_messages WHERE slot = ?", slot),
        sql("DELETE FROM slots WHERE slot = ?", slot),
      ]);
    },
    async addJoinRequest({ id, name, expires }, max, now) {
      return changed(
        "INSERT OR IGNORE INTO join_requests (id, name, expires) SELECT ?, ?, ? WHERE (SELECT COUNT(*) FROM join_requests WHERE expires > ? AND declined = 0) < ?",
        id,
        name,
        expires,
        now,
        max,
      );
    },
    async openJoinRequests(now) {
      const { rows } = await query(
        "SELECT id, name, expires FROM join_requests WHERE expires > ? AND code IS NULL AND declined = 0 ORDER BY expires",
        now,
      );
      return rows as unknown as JoinRequest[];
    },
    async answerJoinRequest(id, code, now) {
      return changed(`UPDATE join_requests SET code = ? WHERE ${UNANSWERED}`, code, id, now);
    },
    async declineJoinRequest(id, now) {
      return changed(`UPDATE join_requests SET declined = 1 WHERE ${UNANSWERED}`, id, now);
    },
    async joinAnswer(id, now) {
      const row = await one(
        "SELECT code, declined FROM join_requests WHERE id = ? AND expires > ?",
        id,
        now,
      );
      return (
        row && { code: (row.code as string | null) ?? undefined, declined: row.declined === 1 }
      );
    },
    async hasJoinRequest(id, now) {
      return (
        (await one("SELECT 1 AS live FROM join_requests WHERE id = ? AND expires > ?", id, now)) !==
        undefined
      );
    },
    async purgeExpired(now) {
      await batch([
        sql("DELETE FROM challenges WHERE expires <= ?", now),
        sql("DELETE FROM join_requests WHERE expires <= ?", now),
        sql(
          "DELETE FROM pair_messages WHERE slot IN (SELECT slot FROM slots WHERE expires <= ?)",
          now,
        ),
        sql("DELETE FROM slots WHERE expires <= ?", now),
      ]);
    },
  };

  const blobs: BlobStore = {
    async put(hash, data) {
      await query("INSERT OR IGNORE INTO blobs (hash, data) VALUES (?, ?)", hash, data);
    },
    async get(hash) {
      return (await one("SELECT data FROM blobs WHERE hash = ?", hash))?.data as
        | Uint8Array
        | undefined;
    },
    async delete(hash) {
      await query("DELETE FROM blobs WHERE hash = ?", hash);
    },
    async clear() {
      await query("DELETE FROM blobs");
    },
  };

  return { meta, blobs };
}
