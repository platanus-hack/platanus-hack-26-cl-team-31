// Escenario de demostración con titulares ficticios. Está escrito como filas de ops.events, con los
// mismos nombres y atributos del catálogo de @team-31/telemetry, y pasa por el mismo mapeo que el
// modo en vivo. Así la landing muestra exactamente lo que el admin vería con el stack real.
import type { FlowEvent } from "./model.js";
import { createFlowDirectory, createTelemetryMapper, type DirectoryRequest, type TelemetryRow } from "./telemetry.js";

const users = [
  { userId: "u-ana", address: "ana@sideband.app", displayName: "Ana" },
  { userId: "u-bob", address: "bob@sideband.app", displayName: "Bob" },
  { userId: "u-carla", address: "carla@sideband.app", displayName: "Carla" },
  { userId: "u-dani", address: "dani@sideband.app", displayName: "Dani" },
  // Se unen durante la demo: no están en la foto inicial.
  { userId: "u-fran", address: "fran@sideband.app", displayName: "Fran" },
  { userId: "u-gabi", address: "gabi@sideband.app", displayName: "Gabi" },
  { userId: "u-hugo", address: "hugo@sideband.app", displayName: "Hugo" },
  { userId: "u-ines", address: "ines@sideband.app", displayName: "Inés" },
];

const initialUsers = new Set(["u-ana", "u-bob", "u-carla", "u-dani"]);

const agents = [
  { agentId: "ana-claude", userId: "u-ana", label: "Claude Code", kind: "mcp_events" },
  { agentId: "bob-grok", userId: "u-bob", label: "Grok Bot", kind: "grokbot_routine" },
  { agentId: "carla-openclaw", userId: "u-carla", label: "OpenClaw", kind: "openclaw_hooks" },
  { agentId: "dani-codex", userId: "u-dani", label: "Codex", kind: "mcp_events" },
  { agentId: "fran-grok", userId: "u-fran", label: "Grok Bot", kind: "grokbot_routine" },
  { agentId: "gabi-grok", userId: "u-gabi", label: "Grok Bot", kind: "grokbot_routine" },
  { agentId: "hugo-grok", userId: "u-hugo", label: "Grok Bot", kind: "grokbot_routine" },
  { agentId: "ines-claude", userId: "u-ines", label: "Claude Code", kind: "mcp_events" },
];

const requests: DirectoryRequest[] = [
  { id: "req-ana-bob", fromAddress: "ana@sideband.app", toAddress: "bob@sideband.app" },
  { id: "req-ana-carla", fromAddress: "ana@sideband.app", toAddress: "carla@sideband.app" },
  { id: "req-bob-carla", fromAddress: "bob@sideband.app", toAddress: "carla@sideband.app" },
  { id: "req-dani-ana", fromAddress: "dani@sideband.app", toAddress: "ana@sideband.app" },
  { id: "req-carla-dani", fromAddress: "carla@sideband.app", toAddress: "dani@sideband.app" },
  { id: "req-dani-fran", fromAddress: "dani@sideband.app", toAddress: "fran@sideband.app" },
];

type Row = Omit<TelemetryRow, "id" | "at" | "attrs"> & { t: number; attrs?: TelemetryRow["attrs"] };

// t: segundos desde el inicio. Los spans (mcp.tool.call, wake.attempt) llevan su duración.
function flows(): Row[] {
  const ask = (t: number, requestId: string, userId: string, agentId: string, tool: string, category: string, decision: "allow" | "deny", rule: string): Row[] => [
    { t, service: "broker", name: "broker.policy.evaluated", requestId, userId, agentId, attrs: { tool, category, decision, rule } },
    { t: t + 0.05, service: "broker", name: "broker.request.created", requestId, userId, agentId, attrs: { tool, rule } },
    { t: t + 0.1, service: "mcp", name: "mcp.tool.call", requestId, userId, agentId, durationMs: 140, status: "ok", attrs: { tool: "sideband_ask", outcome: "ok" } },
  ];
  const wake = (t: number, requestId: string, userId: string, agentId: string, kind: string, attempt: number, ok: boolean, httpStatus: number, durationMs = 180): Row => ({
    t, service: "worker", name: "wake.attempt", requestId, userId, agentId, durationMs, status: ok ? "ok" : "failed",
    attrs: { kind, attempt, ok, httpStatus, code: ok ? "ok" : "http_status" },
  });
  const changed = (t: number, requestId: string, from: string, to: string, by: string): Row => ({
    t, service: "broker", name: "broker.request.status_changed", requestId, attrs: { from, to, by },
  });
  const closed = (t: number, requestId: string, outcome: string, escalated = false): Row => ({
    t, service: "broker", name: "broker.request.closed", requestId, attrs: { outcome, escalated },
  });

  return [
    // 1. Ana (Claude Code) pregunta la disponibilidad de Bob: permiso directo, aviso, respuesta y entrega.
    ...ask(0, "req-ana-bob", "u-ana", "ana-claude", "availability", "availability", "allow", "grant"),
    wake(1.2, "req-ana-bob", "u-bob", "bob-grok", "grokbot_routine", 1, true, 200),
    { t: 3.4, service: "mcp", name: "mcp.tool.call", userId: "u-bob", agentId: "bob-grok", durationMs: 60, status: "ok", attrs: { tool: "sideband_inbox", outcome: "ok" } },
    changed(5.2, "req-ana-bob", "awaiting_agent", "answered", "agent"),
    closed(5.25, "req-ana-bob", "answered"),
    { t: 6.4, service: "mcp", name: "mcp.tool.call", requestId: "req-ana-bob", userId: "u-ana", agentId: "ana-claude", durationMs: 40, status: "ok", attrs: { tool: "sideband_check", outcome: "ok" } },

    // 2. Ana pregunta a Carla por Salud sin permiso: denegación firmada y Carla ni recibe el aviso.
    ...ask(9, "req-ana-carla", "u-ana", "ana-claude", "question", "health", "deny", "no_grant"),
    closed(9.1, "req-ana-carla", "denied"),

    // 3. Bob pregunta a Carla por un interés (círculo). La primera respuesta filtra datos y se bloquea;
    //    la segunda pasa saneada.
    ...ask(13, "req-bob-carla", "u-bob", "bob-grok", "interest_check", "interests", "allow", "circle"),
    wake(14.2, "req-bob-carla", "u-carla", "carla-openclaw", "openclaw_hooks", 1, true, 202),
    { t: 17, service: "broker", name: "broker.reply.rejected", requestId: "req-bob-carla", attrs: { code: "leak_blocked", flags: "leak-guard:leak_private_hint,leak-guard:leak_email" } },
    changed(20, "req-bob-carla", "awaiting_agent", "answered", "agent"),
    { t: 20.05, service: "broker", name: "broker.reply.sanitized", requestId: "req-bob-carla", attrs: { flags: "parse:unknown_field_dropped,redact:redacted", dropped: "note" } },
    closed(20.1, "req-bob-carla", "answered"),

    // 4. Dani (Codex) hace una pregunta abierta a Ana. Su agente pide la decisión de Ana.
    ...ask(23, "req-dani-ana", "u-dani", "dani-codex", "question", "general", "allow", "grant"),
    wake(24.2, "req-dani-ana", "u-ana", "ana-claude", "mcp_events", 1, true, 200),
    changed(26.4, "req-dani-ana", "awaiting_agent", "awaiting_owner", "agent"),
    { t: 30.5, service: "broker", name: "broker.owner.decided", requestId: "req-dani-ana", userId: "u-ana", attrs: { decision: "answer" } },
    changed(30.55, "req-dani-ana", "awaiting_owner", "answered", "owner"),
    closed(30.6, "req-dani-ana", "answered", true),

    // 5. Carla pregunta la disponibilidad de Dani: el aviso falla, se reintenta y nadie responde a tiempo.
    ...ask(33, "req-carla-dani", "u-carla", "carla-openclaw", "availability", "availability", "allow", "grant"),
    wake(34.2, "req-carla-dani", "u-dani", "dani-codex", "mcp_events", 1, false, 503, 900),
    wake(36.4, "req-carla-dani", "u-dani", "dani-codex", "mcp_events", 2, true, 200),
    closed(41.5, "req-carla-dani", "expired"),

    // Fran llega primero. Luego entran Gabi, Hugo e Inés y más tarde Hugo sale.
    { t: 11, service: "broker", name: "broker.agent.connected", userId: "u-fran", agentId: "fran-grok", attrs: { kind: "grokbot_routine" } },
    { t: 27, service: "broker", name: "broker.agent.connected", userId: "u-gabi", agentId: "gabi-grok", attrs: { kind: "grokbot_routine" } },
    { t: 27.15, service: "broker", name: "broker.agent.connected", userId: "u-hugo", agentId: "hugo-grok", attrs: { kind: "grokbot_routine" } },
    { t: 27.3, service: "mcp", name: "mcp.tool.call", userId: "u-ines", agentId: "ines-claude", durationMs: 50, status: "ok", attrs: { tool: "sideband_inbox", outcome: "ok" } },
    { t: 36.5, service: "broker", name: "broker.agent.revoked", userId: "u-hugo", agentId: "hugo-grok", attrs: { by: "owner" } },

    // 6. Dani le pregunta a Fran, que llegó como participante pasivo, por un interés en común.
    ...ask(44, "req-dani-fran", "u-dani", "dani-codex", "interest_check", "interests", "allow", "circle"),
    wake(45.2, "req-dani-fran", "u-fran", "fran-grok", "grokbot_routine", 1, true, 200),
    changed(47.6, "req-dani-fran", "awaiting_agent", "answered", "agent"),
    closed(47.65, "req-dani-fran", "answered"),
  ];
}

/** Filas de telemetría del escenario (útiles para pruebas y para depurar el mapeo). */
export function scenarioRows(start = Date.UTC(2026, 10, 21, 15, 0, 0)): TelemetryRow[] {
  return flows().map(({ t, attrs, ...row }, index) => ({
    ...row,
    id: String(index + 1),
    // Los spans se registran al terminar.
    at: start + Math.round(t * 1000) + (row.durationMs ?? 0),
    traceId: row.requestId ? `trace-${row.requestId}` : null,
    attrs: attrs ?? {},
  }));
}

/** El escenario completo como FlowEvent, mapeado con createTelemetryMapper. */
export function scenarioEvents(start = Date.UTC(2026, 10, 21, 15, 0, 0)): FlowEvent[] {
  // La foto inicial solo conoce a quienes ya estaban; Fran y Gabi se agregan al directorio después.
  const directory = createFlowDirectory({
    users: users.filter((u) => initialUsers.has(u.userId)),
    agents: agents.filter((a) => initialUsers.has(a.userId)),
    requests,
  });
  const mapper = createTelemetryMapper(directory);
  const snapshot = mapper.snapshot(start - 1);
  directory.add({ users, agents });
  return [...snapshot, ...scenarioRows(start).flatMap((row) => mapper.map(row)).sort((a, b) => a.at - b.at)];
}
