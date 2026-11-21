import "server-only";

import { Pool } from "pg";
import { createWhatsAppStore } from "./store";

let db: Pool | undefined;

export function whatsappStore() {
  if (!process.env.DATABASE_URL) throw new Error("Falta DATABASE_URL para WhatsApp.");
  return createWhatsAppStore(db ??= new Pool({ connectionString: process.env.DATABASE_URL,
    max: 6, connectionTimeoutMillis: 3_000, statement_timeout: 5_000, idle_in_transaction_session_timeout: 35_000 }));
}
