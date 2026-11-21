import pg from "pg";
import { afterEach, describe, expect, it } from "vitest";
import { createTestDatabase } from "./index.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

describe("createTestDatabase", () => {
  it("rechaza una base que no termina en _test", async () => {
    await expect(createTestDatabase("x_test", { baseUrl: "postgres://u:p@127.0.0.1:1/app" })).rejects.toThrow("_test");
    await expect(createTestDatabase("Bad-Prefix", { baseUrl: "postgres://u:p@127.0.0.1:1/app_test" })).rejects.toThrow("Prefijo");
  });

  describe.skipIf(!testDatabaseUrl)("contra TEST_DATABASE_URL", () => {
    const originalEnd = pg.Connection.prototype.end;
    afterEach(() => {
      pg.Connection.prototype.end = originalEnd;
    });

    async function exists(name: string) {
      const client = new pg.Client({ connectionString: testDatabaseUrl });
      await client.connect();
      try {
        const { rowCount } = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
        return rowCount === 1;
      } finally {
        await client.end();
      }
    }

    // The race from PR #89: Pool.end() resolves while the backend is still alive. Delaying every
    // Terminate makes it deterministic; dropping with FORCE right away raised an unhandled 57P01.
    it("espera a que los backends cierren antes de eliminar la base", async () => {
      const testDb = await createTestDatabase("test_db_test");
      const pools = [testDb.pool(), new pg.Pool({ connectionString: testDb.url })];
      await Promise.all(pools.map((pool) => pool.query("SELECT 1")));
      pg.Connection.prototype.end = function (this: pg.Connection) {
        setTimeout(() => originalEnd.call(this), 300);
      };
      await pools[1]!.end();
      await testDb.drop();
      pg.Connection.prototype.end = originalEnd;
      await testDb.drop();
      expect(await exists(testDb.name)).toBe(false);
      expect(() => testDb.pool()).toThrow("ya se eliminó");
    });

    it("usa FORCE si un pool queda abierto y no lanza 57P01 en sus pools", async () => {
      const testDb = await createTestDatabase("test_db_test", { drainTimeoutMs: 50 });
      const pool = testDb.pool();
      await pool.query("SELECT 1");
      const leaked = new pg.Client({ connectionString: testDb.url });
      await leaked.connect();
      const leakedError = new Promise((resolve) => leaked.on("error", resolve));
      await testDb.drop();
      expect(await leakedError).toMatchObject({ code: "57P01" });
      expect(await exists(testDb.name)).toBe(false);
    });
  });
});
