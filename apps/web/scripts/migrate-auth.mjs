import { migrateAuth } from "@team-31/auth/server";
import { getAuthOptions } from "../src/lib/auth-env.mjs";

await migrateAuth(getAuthOptions());
console.log("Esquema de autenticación actualizado.");
