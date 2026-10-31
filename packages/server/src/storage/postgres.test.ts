import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import type pg from "pg";
import { afterAll, beforeAll, expect, test } from "vitest";
import { hasDocker } from "../testing/docker.ts";
import { storageContract } from "./contract.ts";
import { openPostgres, postgresPool } from "./postgres.ts";

const IMAGE =
  "postgres:17-alpine@sha256:266d3c257594e195b309ae9d1805e54c788f1d7b375f56bf6c367aac6c917e7b";

if (await hasDocker()) {
  let container: StartedPostgreSqlContainer;
  let admin: pg.Pool;
  const pools: pg.Pool[] = [];
  let databases = 0;

  beforeAll(async () => {
    container = await new PostgreSqlContainer(IMAGE).start();
    admin = postgresPool(container.getConnectionUri());
  }, 120_000);
  afterAll(async () => {
    await Promise.all([...pools, admin].map((pool) => pool.end()));
    await container.stop();
  });

  /** A pool on a fresh database, so every test starts empty. */
  async function freshPool(): Promise<pg.Pool> {
    const name = `test_${++databases}`;
    await admin.query(`CREATE DATABASE ${name}`);
    const url = new URL(container.getConnectionUri());
    url.pathname = `/${name}`;
    const pool = postgresPool(url.toString());
    pools.push(pool);
    return pool;
  }

  storageContract("postgres", async () => openPostgres(await freshPool()));

  test("instances creating the tables at once all succeed", async () => {
    const pool = await freshPool();
    const stores = Array.from({ length: 4 }, () => openPostgres(pool));
    await Promise.all(stores.map((store) => store.meta.getSetting("instance")));
  });

  test("concurrent writes keep the caps and a reader listing meanwhile sees every object", async () => {
    const { meta } = openPostgres(await freshPool());
    const slots = await Promise.all(
      Array.from({ length: 10 }, (_, i) => meta.openSlot(`s${i}`, 100, 3, 0)),
    );
    expect(slots.filter(Boolean)).toHaveLength(3);
    let written = false;
    void Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        meta.putObject({ path: `p${i}`, did: "d1", hash: `h${i}`, size: 1 }),
      ),
    ).then(() => {
      written = true;
    });
    const listed = new Set<string>();
    for (let cursor = 0; ; ) {
      const last = written;
      const page = await meta.changesAfter(cursor, 7);
      for (const change of page) listed.add(change.path);
      cursor = page.at(-1)?.cursor ?? cursor;
      if (last && !page.length) break;
    }
    expect(listed.size).toBe(50);
  });
} else {
  test.skip("postgres storage needs Docker", () => {});
}
