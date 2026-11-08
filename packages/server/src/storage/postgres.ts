import pg from "pg";
import type {
  BlobStore,
  Change,
  JoinRequest,
  MetaStore,
  ObjectRecord,
  PutResult,
  Storage,
} from "./types.ts";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS roster (seq INTEGER PRIMARY KEY, hash TEXT NOT NULL, entry TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS keys (epoch INTEGER NOT NULL, name TEXT NOT NULL, data BYTEA NOT NULL,
  PRIMARY KEY (epoch, name));
CREATE TABLE IF NOT EXISTS objects (cursor BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  path TEXT NOT NULL UNIQUE, did TEXT NOT NULL, hash TEXT NOT NULL, size INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS objects_hash ON objects (hash);
CREATE TABLE IF NOT EXISTS blobs (hash TEXT PRIMARY KEY, data BYTEA NOT NULL);
CREATE TABLE IF NOT EXISTS devices (did TEXT PRIMARY KEY, seen BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS challenges (id TEXT PRIMARY KEY, did TEXT NOT NULL, expires BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS slots (slot TEXT PRIMARY KEY, expires BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS pair_messages (slot TEXT NOT NULL, name TEXT NOT NULL, data BYTEA NOT NULL,
  PRIMARY KEY (slot, name));
CREATE TABLE IF NOT EXISTS join_requests (id TEXT PRIMARY KEY, name TEXT NOT NULL,
  expires BIGINT NOT NULL, code TEXT, declined BOOLEAN NOT NULL DEFAULT FALSE);
`;

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

/** Advisory lock ids for writes that check before they insert. */
const LOCK = { schema: 1, roster: 2, objects: 3, slots: 4, joins: 5 } as const;

const UNANSWERED = "id = $1 AND expires > $2 AND code IS NULL AND NOT declined";

type Row = Record<string, unknown>;
type Query = (sql: string, params?: unknown[]) => Promise<Row[]>;

/** Times and counts fit in a double; pg would return BIGINT as a string. */
const types: pg.CustomTypesConfig = {
  getTypeParser: ((oid: number, format?: "text" | "binary") =>
    oid === pg.types.builtins.INT8
      ? Number
      : pg.types.getTypeParser(oid, format)) as typeof pg.types.getTypeParser,
};

const bytes = (value: unknown) => {
  const buffer = value as Buffer;
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength).slice();
};

/** Heroku and Vercel (Neon) set DATABASE_URL; Netlify Database sets NETLIFY_DATABASE_URL. */
export function databaseUrl(env: Record<string, string | undefined>): string | undefined {
  return env.FLOW_SYNC_DATABASE_URL ?? env.DATABASE_URL ?? env.NETLIFY_DATABASE_URL;
}

export function postgresPool(connectionString: string): pg.Pool {
  const pool = new pg.Pool({ connectionString, types });
  // An idle client lost its connection: the pool drops it, and the next query reports a lasting
  // failure. Unhandled, the event would stop the process.
  pool.on("error", () => {});
  return pool;
}

/** Creates the tables on first use; the pool belongs to the caller. */
export function openPostgres(pool: pg.Pool): Storage {
  async function transaction<T>(lock: number, body: (query: Query) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    // The pool listens only while a client is idle, and an unheard `error` stops the process.
    let lost: Error | undefined;
    const onError = (error: Error) => {
      lost = error;
    };
    client.on("error", onError);
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock($1)", [lock]);
      const result = await body(async (sql, params) => (await client.query(sql, params)).rows);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.off("error", onError);
      client.release(lost);
    }
  }

  let ready: Promise<unknown> | undefined;
  const schema = () =>
    (ready ??= transaction(LOCK.schema, (q) => q(SCHEMA)).catch((error) => {
      ready = undefined;
      throw error;
    }));
  const query: Query = async (sql, params) => {
    await schema();
    return (await pool.query(sql, params)).rows;
  };
  const locked = async <T>(lock: number, body: (query: Query) => Promise<T>) => {
    await schema();
    return transaction(lock, body);
  };

  async function putImmutable(
    insert: Query,
    sql: string,
    params: unknown[],
    same: () => Promise<boolean>,
  ): Promise<PutResult> {
    if ((await insert(sql, params)).length) return "created";
    return (await same()) ? "identical" : "conflict";
  }

  const meta: MetaStore = {
    async getSetting(key) {
      return (await query("SELECT value FROM settings WHERE key = $1", [key]))[0]?.value as
        | string
        | undefined;
    },
    async setSettingOnce(key, value) {
      const sql =
        "INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING key";
      return (await query(sql, [key, value])).length === 1;
    },
    async reset(keep) {
      await locked(LOCK.roster, async (q) => {
        for (const table of GROUP_TABLES) await q(`DELETE FROM ${table}`);
        await q("DELETE FROM settings WHERE NOT (key = ANY($1))", [keep]);
      });
    },

    async rosterAfter(seq, limit) {
      const sql = "SELECT entry FROM roster WHERE seq > $1 ORDER BY seq LIMIT $2";
      return (await query(sql, [seq, limit])).map((row) => row.entry as string);
    },
    async appendRoster(append) {
      return locked(LOCK.roster, async (q) => {
        const [head] = await q("SELECT seq, hash FROM roster ORDER BY seq DESC LIMIT 1");
        const expected =
          append.prev === undefined ? undefined : { seq: append.seq - 1, hash: append.prev };
        if (head?.seq !== expected?.seq || head?.hash !== expected?.hash) return false;
        await q("INSERT INTO roster (seq, hash, entry) VALUES ($1, $2, $3)", [
          append.seq,
          append.hash,
          append.entry,
        ]);
        for (const key of append.keys) {
          await q("INSERT INTO keys (epoch, name, data) VALUES ($1, $2, $3)", [
            key.epoch,
            key.name,
            key.data,
          ]);
        }
        return true;
      });
    },
    async getKey(epoch, name) {
      const [row] = await query("SELECT data FROM keys WHERE epoch = $1 AND name = $2", [
        epoch,
        name,
      ]);
      return row && bytes(row.data);
    },

    async putObject(record) {
      // Inserting under a lock commits cursors in order, so a reader never skips a later commit.
      return locked(LOCK.objects, (q) =>
        putImmutable(
          q,
          "INSERT INTO objects (path, did, hash, size) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING RETURNING cursor",
          [record.path, record.did, record.hash, record.size],
          async () =>
            (await q("SELECT hash FROM objects WHERE path = $1", [record.path]))[0]?.hash ===
            record.hash,
        ),
      );
    },
    async getObject(path) {
      const sql = "SELECT path, did, hash, size FROM objects WHERE path = $1";
      return (await query(sql, [path]))[0] as ObjectRecord | undefined;
    },
    async deleteObject(path) {
      const sql = "DELETE FROM objects WHERE path = $1 RETURNING path, did, hash, size";
      return (await query(sql, [path]))[0] as ObjectRecord | undefined;
    },
    async isHashUsed(hash) {
      return (await query("SELECT 1 FROM objects WHERE hash = $1 LIMIT 1", [hash])).length === 1;
    },
    async changesAfter(cursor, limit) {
      const sql =
        "SELECT cursor, path, size FROM objects WHERE cursor > $1 ORDER BY cursor LIMIT $2";
      return (await query(sql, [cursor, limit])) as unknown as Change[];
    },
    async usage() {
      const [row] = await query(
        "SELECT COALESCE(SUM(size), 0)::BIGINT AS bytes, COUNT(*) AS objects FROM objects",
      );
      return { bytes: row?.bytes as number, objects: row?.objects as number };
    },

    async touchDevice(did, at) {
      await query(
        "INSERT INTO devices (did, seen) VALUES ($1, $2) ON CONFLICT (did) DO UPDATE SET seen = excluded.seen",
        [did, at],
      );
    },
    async devices() {
      const rows = await query("SELECT did, seen FROM devices ORDER BY did");
      return Object.fromEntries(rows.map((row) => [row.did as string, row.seen as number]));
    },

    async putChallenge(id, did, expires) {
      await query("INSERT INTO challenges (id, did, expires) VALUES ($1, $2, $3)", [
        id,
        did,
        expires,
      ]);
    },
    async takeChallenge(id) {
      const sql = "DELETE FROM challenges WHERE id = $1 RETURNING did, expires";
      return (await query(sql, [id]))[0] as { did: string; expires: number } | undefined;
    },

    async openSlot(slot, expires, max, now) {
      return locked(LOCK.slots, async (q) => {
        const [open] = await q("SELECT COUNT(*) AS n FROM slots WHERE expires > $1", [now]);
        if ((open?.n as number) >= max) return false;
        const sql =
          "INSERT INTO slots (slot, expires) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING slot";
        return (await q(sql, [slot, expires])).length === 1;
      });
    },
    async slotExpiry(slot) {
      return (await query("SELECT expires FROM slots WHERE slot = $1", [slot]))[0]?.expires as
        | number
        | undefined;
    },
    async putPairMessage(slot, name, data) {
      return putImmutable(
        query,
        "INSERT INTO pair_messages (slot, name, data) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING slot",
        [slot, name, data],
        async () =>
          (
            await query("SELECT 1 FROM pair_messages WHERE slot = $1 AND name = $2 AND data = $3", [
              slot,
              name,
              data,
            ])
          ).length === 1,
      );
    },
    async getPairMessage(slot, name) {
      const sql = "SELECT data FROM pair_messages WHERE slot = $1 AND name = $2";
      const [row] = await query(sql, [slot, name]);
      return row && bytes(row.data);
    },
    async deleteSlot(slot) {
      await locked(LOCK.slots, async (q) => {
        await q("DELETE FROM pair_messages WHERE slot = $1", [slot]);
        await q("DELETE FROM slots WHERE slot = $1", [slot]);
      });
    },
    async addJoinRequest({ id, name, expires }, max, now) {
      return locked(LOCK.joins, async (q) => {
        const [live] = await q(
          "SELECT COUNT(*) AS n FROM join_requests WHERE expires > $1 AND NOT declined",
          [now],
        );
        if ((live?.n as number) >= max) return false;
        const sql =
          "INSERT INTO join_requests (id, name, expires) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING id";
        return (await q(sql, [id, name, expires])).length === 1;
      });
    },
    async openJoinRequests(now) {
      const sql =
        "SELECT id, name, expires FROM join_requests WHERE expires > $1 AND code IS NULL AND NOT declined ORDER BY expires";
      return (await query(sql, [now])) as unknown as JoinRequest[];
    },
    async answerJoinRequest(id, code, now) {
      const sql = `UPDATE join_requests SET code = $3 WHERE ${UNANSWERED} RETURNING id`;
      return (await query(sql, [id, now, code])).length === 1;
    },
    async declineJoinRequest(id, now) {
      const sql = `UPDATE join_requests SET declined = TRUE WHERE ${UNANSWERED} RETURNING id`;
      return (await query(sql, [id, now])).length === 1;
    },
    async joinAnswer(id, now) {
      const sql = "SELECT code, declined FROM join_requests WHERE id = $1 AND expires > $2";
      const [row] = await query(sql, [id, now]);
      return (
        row && { code: (row.code as string | null) ?? undefined, declined: row.declined as boolean }
      );
    },
    async hasJoinRequest(id, now) {
      const sql = "SELECT 1 FROM join_requests WHERE id = $1 AND expires > $2";
      return (await query(sql, [id, now])).length === 1;
    },
    async purgeExpired(now) {
      await locked(LOCK.slots, async (q) => {
        await q("DELETE FROM challenges WHERE expires <= $1", [now]);
        await q("DELETE FROM join_requests WHERE expires <= $1", [now]);
        await q(
          "DELETE FROM pair_messages WHERE slot IN (SELECT slot FROM slots WHERE expires <= $1)",
          [now],
        );
        await q("DELETE FROM slots WHERE expires <= $1", [now]);
      });
    },
  };

  const blobs: BlobStore = {
    async put(hash, data) {
      await query("INSERT INTO blobs (hash, data) VALUES ($1, $2) ON CONFLICT DO NOTHING", [
        hash,
        data,
      ]);
    },
    async get(hash) {
      const [row] = await query("SELECT data FROM blobs WHERE hash = $1", [hash]);
      return row && bytes(row.data);
    },
    async delete(hash) {
      await query("DELETE FROM blobs WHERE hash = $1", [hash]);
    },
    async clear() {
      await query("DELETE FROM blobs");
    },
  };

  return { meta, blobs };
}
