import { DatabaseSync } from "node:sqlite";
import { openSqliteStore, type Row, type SqlResult, type SqlStatement } from "./sqlite-store.ts";
import type { Storage } from "./types.ts";

/** Opens (or creates) a database file; `:memory:` works for tests. */
export function openSqlite(path: string): Storage {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");

  const run = ({ sql, params }: SqlStatement): SqlResult => {
    const statement = db.prepare(sql);
    if (statement.columns().length) return { rows: statement.all(...params) as Row[], changes: 0 };
    return { rows: [], changes: Number(statement.run(...params).changes) };
  };

  return openSqliteStore({
    async query(statement) {
      return run(statement);
    },
    async batch(statements) {
      db.exec("BEGIN IMMEDIATE");
      try {
        const results = statements.map(run);
        db.exec("COMMIT");
        return results;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
  });
}
