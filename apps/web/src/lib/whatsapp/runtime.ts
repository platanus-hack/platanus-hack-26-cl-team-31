import "server-only";

import { createMessageRuntime } from "@team-31/message-flow/runtime";
import { getTelemetry } from "../telemetry";
import { Pool } from "pg";
import { createWhatsAppStore } from "./store";

let store: ReturnType<typeof createWhatsAppStore> | undefined;

export function whatsappStore() {
  if (store) return store;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("Falta DATABASE_URL para WhatsApp.");
  const options = { connectionString, max: 6, connectionTimeoutMillis: 3_000,
    statement_timeout: 5_000, idle_in_transaction_session_timeout: 35_000 };
  store = createWhatsAppStore(new Pool(options));
  return store;
}

let flow: ReturnType<typeof createMessageRuntime>;
export function whatsappMessageRuntime() {
  return flow ??= createMessageRuntime(getTelemetry());
}
