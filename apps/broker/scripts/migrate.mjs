import { applyPostgresMigrations } from "@team-31/broker/postgres";

await applyPostgresMigrations({ databaseUrl: process.env.DATABASE_URL });
console.log("Migraciones del broker aplicadas.");
