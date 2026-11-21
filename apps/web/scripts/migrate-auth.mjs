import { readFile } from "node:fs/promises";
import { migrateAuth } from "@team-31/auth/server";
import pg from "pg";
import { getAuthOptions } from "../src/lib/auth-env.mjs";

const options = getAuthOptions();
await migrateAuth(options);
const pool = new pg.Pool({ connectionString: options.databaseUrl });
try {
  await pool.query(await readFile(new URL("./whatsapp.sql", import.meta.url), "utf8"));
} finally {
  await pool.end();
}
console.log("Esquema de autenticación actualizado.");
