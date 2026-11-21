import { randomUUID } from "node:crypto";
import pg from "pg";
import { describe, expect, it } from "vitest";
import { applyOpsMigrations } from "./index.js";

describe("applyOpsMigrations", () => {
  it("requires a database URL", async () => {
    await expect(applyOpsMigrations({ databaseUrl: "" })).rejects.toThrow("DATABASE_URL");
  });

  it.skipIf(!process.env.TEST_DATABASE_URL)("applies each migration once across concurrent runs", async () => {
    const url = new URL(process.env.TEST_DATABASE_URL!);
    if (!url.pathname.endsWith("_test")) {
      throw new Error("TEST_DATABASE_URL debe apuntar a una base _test separada.");
    }

    const databaseName = `ops_test_${randomUUID().replaceAll("-", "")}`;
    const identifier = pg.escapeIdentifier(databaseName);
    const admin = new pg.Pool({ connectionString: url.href });
    try {
      await admin.query(`CREATE DATABASE ${identifier}`);
      try {
        url.pathname = `/${databaseName}`;
        const run = () => applyOpsMigrations({ databaseUrl: url.href });
        const runs = await Promise.allSettled([run(), run()]);
        for (const result of runs) {
          if (result.status === "rejected") throw result.reason;
        }
        const applied = runs.flatMap((result) => result.status === "fulfilled" ? result.value : []);
        expect(applied).toContain("0001_events.sql");
        expect(applied).toEqual([...new Set(applied)]);
        await expect(run()).resolves.toEqual([]);
      } finally {
        await admin.query(`DROP DATABASE ${identifier}`);
      }
    } finally {
      await admin.end();
    }
  });
});
