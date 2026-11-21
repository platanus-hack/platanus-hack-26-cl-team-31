// Throwaway Postgres databases for tests, created from TEST_DATABASE_URL and dropped without races.
//
// pg's Pool.end() resolves once it has *asked* its clients to close, before the server has let go
// of their backends. DROP DATABASE ... WITH (FORCE) right after it kills those backends, the server
// sends FATAL 57P01 to a client that is still closing, and the pool re-emits it as an 'error'.
// Without a listener that is an uncaught exception and Vitest fails the run (see PR #89). So drop()
// waits until pg_stat_activity shows no backend on the database and keeps FORCE as a fallback.
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import pg from "pg";

export interface TestDatabase {
  /** Database name: `<prefix>_<32 hex>`. */
  readonly name: string;
  /** TEST_DATABASE_URL pointing at this database. */
  readonly url: string;
  /** A pool on this database, ended by drop() and already guarded by ignoreTerminationAfterEnd. */
  pool(config?: Omit<pg.PoolConfig, "connectionString">): pg.Pool;
  /** Ends the pools from pool(), waits for every backend to leave and drops the database. */
  drop(): Promise<void>;
}

export interface TestDatabaseOptions {
  /** Defaults to process.env.TEST_DATABASE_URL. Its database name must end in `_test`. */
  baseUrl?: string;
  /** How long drop() waits for backends to leave before falling back to FORCE. */
  drainTimeoutMs?: number;
}

const POLL_MS = 10;

/**
 * Without a listener, an idle client that loses its backend re-emits on the pool as an uncaught
 * exception. Only a 57P01 (admin shutdown) after end() is expected, from the FORCE fallback; any
 * other error is rethrown so it still fails the run.
 */
export function ignoreTerminationAfterEnd<T extends pg.Pool>(pool: T): T {
  pool.on("error", (error: Error & { code?: string }) => {
    if (pool.ending && error.code === "57P01") return;
    throw error;
  });
  return pool;
}

/** Refuses anything but a separate `_test` database (and never the one in DATABASE_URL). */
function testBaseUrl(baseUrl: string | undefined): URL {
  if (!baseUrl) throw new Error("Falta TEST_DATABASE_URL.");
  const url = new URL(baseUrl);
  const devUrl = process.env.DATABASE_URL;
  if (!url.pathname.endsWith("_test") || (devUrl && url.pathname === new URL(devUrl).pathname)) {
    throw new Error("TEST_DATABASE_URL debe apuntar a una base _test separada.");
  }
  return url;
}

async function withClient<T>(url: string, run: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

/** Creates `<prefix>_<uuid>` next to TEST_DATABASE_URL so suites running in parallel never share one. */
export async function createTestDatabase(prefix: string, options: TestDatabaseOptions = {}): Promise<TestDatabase> {
  if (!/^[a-z][a-z0-9_]{0,29}$/.test(prefix)) throw new Error(`Prefijo de base inválido: ${prefix}`);
  const base = testBaseUrl(options.baseUrl ?? process.env.TEST_DATABASE_URL);
  const drainTimeoutMs = options.drainTimeoutMs ?? 5_000;
  const name = `${prefix}_${randomUUID().replaceAll("-", "")}`;
  const identifier = pg.escapeIdentifier(name);
  await withClient(base.href, (admin) => admin.query(`CREATE DATABASE ${identifier}`));

  const url = new URL(base.href);
  url.pathname = "/" + name;
  const pools: pg.Pool[] = [];
  let dropped: Promise<void> | undefined;

  async function drop() {
    await Promise.all(pools.map((pool) => (pool.ending ? undefined : pool.end())));
    await withClient(base.href, async (admin) => {
      const deadline = Date.now() + drainTimeoutMs;
      for (;;) {
        const { rows } = await admin.query<{ count: number }>(
          "SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname = $1",
          [name],
        );
        if (rows[0]?.count === 0 || Date.now() >= deadline) break;
        await sleep(POLL_MS);
      }
      // A no-op once drained; after the timeout it ends whatever pool the test leaked.
      await admin.query(`DROP DATABASE IF EXISTS ${identifier} WITH (FORCE)`);
    });
  }

  return {
    name,
    url: url.href,
    pool(config = {}) {
      if (dropped) throw new Error(`La base ${name} ya se eliminó.`);
      const pool = ignoreTerminationAfterEnd(new pg.Pool({ ...config, connectionString: url.href }));
      pools.push(pool);
      return pool;
    },
    drop() {
      dropped ??= drop();
      return dropped;
    },
  };
}
