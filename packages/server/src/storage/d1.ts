import { openSqliteStore, type Row, type SqlStatement } from "./sqlite-store.ts";
import type { Storage } from "./types.ts";

/** D1 returns BLOB columns as arrays of numbers. */
function bytesIn(row: Row): Row {
  for (const [key, value] of Object.entries(row))
    if (Array.isArray(value)) row[key] = Uint8Array.from(value);
  return row;
}

export function openD1(db: D1Database): Storage {
  const prepare = ({ sql, params }: SqlStatement) => db.prepare(sql).bind(...params);
  const result = ({ results, meta }: D1Result<Row>) => ({
    rows: results.map(bytesIn),
    changes: meta.changes,
  });
  return openSqliteStore({
    async query(statement) {
      return result(await prepare(statement).all<Row>());
    },
    async batch(statements) {
      return (await db.batch<Row>(statements.map(prepare))).map(result);
    },
  });
}
