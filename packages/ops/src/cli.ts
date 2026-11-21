import { applyOpsMigrations } from "./index.js";

const applied = await applyOpsMigrations({ databaseUrl: process.env.DATABASE_URL ?? "" });
process.stdout.write(applied.length ? `ops: aplicadas ${applied.join(", ")}\n` : "ops: sin migraciones pendientes\n");
