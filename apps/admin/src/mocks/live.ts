// Simula el stream SSE de /api/admin/live: genera eventos de telemetría creíbles con
// intervalos irregulares y respeta los mismos filtros que el servidor.
import type { Service, TelemetryEvent } from "@shared/contract"

import type { LiveFilters, LiveHandlers } from "@/lib/api"
import { hex, historyEvents, nextEventId, requests, uuid } from "@/mocks/fixtures"

type Template = Pick<TelemetryEvent, "service" | "kind" | "name" | "level"> & {
  weight: number
  status?: string
  durationMs?: () => number
  attrs: () => TelemetryEvent["attrs"]
  withRequest?: boolean
  error?: boolean
}

const r = (min: number, max: number) =>
  Math.round(min + Math.random() * (max - min))
const one = <T>(items: readonly T[]) =>
  items[Math.floor(Math.random() * items.length)]!

const templates: Template[] = [
  {
    weight: 10,
    service: "mcp",
    kind: "http",
    name: "http.request",
    level: "info",
    status: "200",
    durationMs: () => r(8, 180),
    attrs: () => ({
      method: "POST",
      route: "/mcp",
      status: 200,
      bucket: "mcp",
    }),
  },
  {
    weight: 8,
    service: "broker",
    kind: "http",
    name: "http.request",
    level: "info",
    status: "200",
    durationMs: () => r(3, 70),
    attrs: () => ({
      method: one(["GET", "POST"]),
      route: one([
        "/v1/agent/ask",
        "/v1/agent/reply",
        "/v1/owner/activity",
        "/v1/agent/pending",
      ]),
      status: one([200, 200, 201, 204]),
      bucket: "agent",
    }),
  },
  {
    weight: 6,
    service: "mcp",
    kind: "tool",
    name: "mcp.tool.call",
    level: "info",
    status: "ok",
    durationMs: () => r(20, 400),
    withRequest: true,
    attrs: () => ({
      tool: one(["ask_contact", "await_contact", "list_contacts"]),
      outcome: "ok",
    }),
  },
  {
    weight: 5,
    service: "broker",
    kind: "policy",
    name: "broker.policy.evaluated",
    level: "info",
    withRequest: true,
    durationMs: () => r(1, 8),
    attrs: () => ({
      tool: one(["availability", "question", "profile", "interest_check"]),
      decision: one(["allow", "allow", "allow", "deny", "ask_owner"]),
      rule: one([
        "circle:amigos",
        "circle:trabajo",
        "person",
        "default:ask_owner",
      ]),
    }),
  },
  {
    weight: 5,
    service: "broker",
    kind: "lifecycle",
    name: "broker.request.status_changed",
    level: "info",
    withRequest: true,
    attrs: () => ({
      from: "awaiting_agent",
      to: one([
        "answered",
        "answered",
        "no_data",
        "declined",
        "awaiting_owner",
      ]),
      by: one(["agent", "owner", "broker"]),
    }),
  },
  {
    weight: 5,
    service: "worker",
    kind: "wake",
    name: "wake.attempt",
    level: "info",
    status: "ok",
    withRequest: true,
    durationMs: () => r(120, 900),
    attrs: () => ({
      kind: one(["mcp_events", "openclaw_hooks", "standard_webhook"]),
      attempt: 1,
      ok: true,
      httpStatus: 202,
      code: null,
    }),
  },
  {
    weight: 3,
    service: "worker",
    kind: "wake",
    name: "wake.attempt",
    level: "warn",
    status: "error",
    withRequest: true,
    durationMs: () => 10_000,
    attrs: () => ({
      kind: "grokbot_routine",
      attempt: r(1, 3),
      ok: false,
      httpStatus: one([504, 502]),
      code: "timeout",
    }),
  },
  {
    weight: 3,
    service: "web",
    kind: "auth",
    name: "auth.token.verified",
    level: "info",
    attrs: () => ({ issuer: "web", reason: null }),
  },
  {
    weight: 1,
    service: "mcp",
    kind: "auth",
    name: "auth.token.rejected",
    level: "warn",
    attrs: () => ({ issuer: "web", reason: one(["expired", "audience"]) }),
  },
  {
    weight: 1,
    service: "broker",
    kind: "http",
    name: "http.rate_limited",
    level: "warn",
    attrs: () => ({ route: "/v1/agent/ask", bucket: "agent" }),
  },
  {
    weight: 1,
    service: "broker",
    kind: "error",
    name: "error",
    level: "error",
    status: "error",
    error: true,
    withRequest: true,
    attrs: () => ({
      operation: "POST /v1/agent/reply",
      type: "TypeError",
      issues: "result.freeSlots[0]: formato inválido",
      frames: "at parseReply (packages/broker/src/core/reply.ts:88:17)",
    }),
  },
  {
    weight: 1,
    service: "coordination",
    kind: "tool",
    name: "coordination.tool.call",
    level: "info",
    durationMs: () => r(10, 120),
    attrs: () => ({
      tool: one(["list_contacts", "await_contact"]),
      outcome: "ok",
    }),
  },
  {
    weight: 2,
    service: "admin",
    kind: "admin",
    name: "admin.mcp.call",
    level: "info",
    attrs: () => ({
      action: "call",
      target: null,
      tool: one(["admin_overview", "admin_get_request", "admin_errors"]),
    }),
  },
]

const totalWeight = templates.reduce((sum, t) => sum + t.weight, 0)
function pickTemplate(): Template {
  let roll = Math.random() * totalWeight
  for (const t of templates) {
    roll -= t.weight
    if (roll <= 0) return t
  }
  return templates[0]!
}

function makeEvent(): TelemetryEvent {
  const t = pickTemplate()
  const request = t.withRequest ? one(requests.slice(0, 20)).summary : null
  return {
    id: nextEventId(),
    at: new Date().toISOString(),
    service: t.service,
    kind: t.kind,
    name: t.name,
    level: t.level,
    traceId: hex(32),
    spanId: hex(16),
    parentSpanId: Math.random() < 0.6 ? hex(16) : null,
    requestId: request?.id ?? null,
    userId: null,
    agentId: request?.targetAgentId ?? null,
    durationMs: t.durationMs?.() ?? null,
    status: t.status ?? null,
    errorId: t.error ? uuid() : null,
    attrs: t.attrs(),
  }
}

function matches(event: TelemetryEvent, filters: LiveFilters): boolean {
  if (filters.service && event.service !== (filters.service as Service))
    return false
  if (filters.kind && event.kind !== filters.kind) return false
  if (filters.level && event.level !== filters.level) return false
  if (filters.name && event.name !== filters.name) return false
  if (filters.requestId && event.requestId !== filters.requestId) return false
  if (filters.traceId && event.traceId !== filters.traceId) return false
  if (filters.userId && event.userId !== filters.userId) return false
  return true
}

export function startMockLive(
  filters: LiveFilters,
  handlers: LiveHandlers
): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  const open = setTimeout(() => {
    handlers.onStatus("open")
    const initial = historyEvents().filter((event) => matches(event, filters))
    for (const event of initial.slice(0, 50).reverse()) handlers.onEvent(event)
  }, 300)
  const tick = () => {
    // Ráfagas ocasionales para que se sienta como tráfico real.
    const burst = Math.random() < 0.15 ? r(2, 5) : 1
    for (let i = 0; i < burst; i++) {
      const event = makeEvent()
      if (matches(event, filters)) handlers.onEvent(event)
    }
    timer = setTimeout(tick, r(600, 2200))
  }
  timer = setTimeout(tick, 500)
  return () => {
    clearTimeout(open)
    clearTimeout(timer)
  }
}
