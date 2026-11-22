import { ToolResultSchemas, invalidInputMessage, type RequestStatus, type ToolName, type ToolResult } from "@team-31/protocol";
import { BrokerError } from "../errors.js";
import type { RequestRow } from "../store/store.js";

const transitions: Record<RequestStatus, readonly RequestStatus[]> = {
  awaiting_agent: ["denied", "awaiting_owner", "answered", "no_data", "declined", "expired", "delivery_failed"],
  awaiting_owner: ["awaiting_agent", "answered", "declined", "expired"],
  answered: [],
  no_data: [],
  declined: [],
  denied: [],
  expired: [],
  delivery_failed: [],
};

export function transition(row: RequestRow, status: RequestStatus): RequestRow {
  if (!transitions[row.status].includes(status) || (status === "awaiting_owner" && row.escalated)) {
    throw new BrokerError("conflict", "La solicitud no admite esta transición.");
  }
  return { ...row, status };
}

export function approveOnce(row: RequestRow): RequestRow {
  const fields = ToolResultSchemas[row.tool].shape;
  const required = Object.entries(fields).filter(([, schema]) => !schema.safeParse(undefined).success);
  return {
    ...transition(row, "awaiting_agent"),
    allowedFields: required.map(([field]) => field),
    approvedOnce: true,
    rule: "Permiso del dueño por única vez",
    guidance: "",
  };
}

export function escalate(row: RequestRow, expiresAt: Date): RequestRow {
  return {
    ...transition(row, "awaiting_owner"),
    escalated: true,
    expiresAt,
    decisionReason: "El agente pidió una decisión del dueño.",
  };
}

export function parseResult(tool: ToolName, result: unknown): ToolResult {
  const parsed = ToolResultSchemas[tool].safeParse(result);
  // El resultado lo escribió quien responde: nombrar el campo que falla no revela nada ajeno.
  if (!parsed.success) {
    throw new BrokerError("invalid_input", invalidInputMessage(`La respuesta no cumple el formato de ${tool}.`, parsed.error));
  }
  return parsed.data;
}
