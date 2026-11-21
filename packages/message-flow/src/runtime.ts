import type { Telemetry } from "@team-31/telemetry";
import { createClaudeInterpreter } from "./anthropic.js";
import { createMessageFlow } from "./index.js";
import { createPostgresTurnStore } from "./postgres.js";

export function createMessageRuntime(telemetry: Telemetry) {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return undefined;
  const database = process.env.MESSAGE_FLOW_DATABASE_URL || process.env.DATABASE_URL;
  if (!database) throw new Error("Configura MESSAGE_FLOW_DATABASE_URL o DATABASE_URL para los turnos de Sideband.");
  const store = createPostgresTurnStore(database, telemetry);
  const interpret = createClaudeInterpreter({ apiKey, model: process.env.MESSAGE_FLOW_MODEL || undefined });
  return { ...createMessageFlow({ interpret, store, telemetry }), latestContinuation: store.latestContinuation, close: store.close };
}
