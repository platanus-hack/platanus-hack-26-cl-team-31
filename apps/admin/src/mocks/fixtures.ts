// Fixtures tipadas con el contrato para el modo mock (VITE_ADMIN_MOCK=1). Se generan con
// un PRNG con semilla para que los datos sean estables entre recargas, con fechas relativas
// al momento de carga. Incluye solicitudes en todos los estados, avisos de grokbot fallando,
// errores agrupados y una traza completa mcp → broker → worker.
import type {
  AdminToken,
  AgentRow,
  AuditEntry,
  ErrorGroup,
  RequestDetail,
  RequestSummary,
  Service,
  ServiceHealth,
  TelemetryEvent,
  TimelineItem,
  Trace,
  UserSummary,
  WakeJobRow,
} from "@shared/contract"
import type {
  FinalOutcome,
  RequestStatus,
  ToolName,
  WakeKind,
} from "@team-31/protocol"

// ---------- utilidades ----------

function mulberry32(seed: number) {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const rand = mulberry32(31)
export const pick = <T>(items: readonly T[]): T =>
  items[Math.floor(rand() * items.length)]!
export const between = (min: number, max: number) =>
  Math.round(min + rand() * (max - min))

const alphabet = "0123456789abcdefghijkmnpqrstuvwxyz"
export const shortId = (prefix: string, length = 10) =>
  prefix +
  Array.from(
    { length },
    () => alphabet[Math.floor(rand() * alphabet.length)]
  ).join("")
export const hex = (length: number) =>
  Array.from({ length }, () => Math.floor(rand() * 16).toString(16)).join("")
export const uuid = () =>
  `${hex(8)}-${hex(4)}-4${hex(3)}-${pick(["8", "9", "a", "b"])}${hex(3)}-${hex(12)}`

export const NOW = Date.now()
const MIN = 60_000
const HOUR = 60 * MIN
export const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString()
const isoAt = (ms: number) => new Date(ms).toISOString()

let eventSeq = 9_000_000
export const nextEventId = () => String(++eventSeq)

// ---------- personas y agentes ----------

type Person = {
  userId: string
  address: string
  displayName: string | null
  email: string
  createdAgo: number
}

export const people: Person[] = [
  {
    userId: "usr_simon",
    address: "simon@nexo.app",
    displayName: "Simón Pérez",
    email: "simon@gmail.com",
    createdAgo: 9 * 24 * HOUR,
  },
  {
    userId: "usr_diego",
    address: "diego@nexo.app",
    displayName: "Diego Rojas",
    email: "diego.rojas@gmail.com",
    createdAgo: 8 * 24 * HOUR,
  },
  {
    userId: "usr_adolfo",
    address: "adolfo@nexo.app",
    displayName: "Adolfo Vidal",
    email: "adolfo@platan.us",
    createdAgo: 8 * 24 * HOUR,
  },
  {
    userId: "usr_ana",
    address: "ana@nexo.app",
    displayName: "Ana Muñoz",
    email: "ana.munoz@gmail.com",
    createdAgo: 6 * 24 * HOUR,
  },
  {
    userId: "usr_bob",
    address: "bob@nexo.app",
    displayName: "Bob Salinas",
    email: "bob@salinas.cl",
    createdAgo: 5 * 24 * HOUR,
  },
  {
    userId: "usr_carla",
    address: "carla@nexo.app",
    displayName: "Carla Fuentes",
    email: "carla.f@gmail.com",
    createdAgo: 3 * 24 * HOUR,
  },
  {
    userId: "usr_tomas",
    address: "tomas@nexo.app",
    displayName: "Tomás Lagos",
    email: "tlagos@uc.cl",
    createdAgo: 2 * 24 * HOUR,
  },
  {
    userId: "usr_eva",
    address: "eva@nexo.app",
    displayName: null,
    email: "eva@example.org",
    createdAgo: 20 * HOUR,
  },
]

type AgentSeed = {
  userId: string
  agentId: string
  label: string
  wakeKind: WakeKind
  wakeHost: string | null
  failing?: boolean
  revoked?: boolean
}

const agentSeeds: AgentSeed[] = [
  {
    userId: "usr_simon",
    agentId: "agt_claude_code",
    label: "Claude Code (MacBook)",
    wakeKind: "mcp_events",
    wakeHost: "nexo-relay.simon.dev",
  },
  {
    userId: "usr_simon",
    agentId: "agt_openclaw",
    label: "OpenClaw casa",
    wakeKind: "openclaw_hooks",
    wakeHost: "claw.simon.dev",
  },
  {
    userId: "usr_diego",
    agentId: "agt_grok",
    label: "Grok rutina",
    wakeKind: "grokbot_routine",
    wakeHost: "routines.grok.x.ai",
    failing: true,
  },
  {
    userId: "usr_adolfo",
    agentId: "agt_webhook",
    label: "Webhook n8n",
    wakeKind: "standard_webhook",
    wakeHost: "n8n.platan.us",
  },
  {
    userId: "usr_ana",
    agentId: "agt_claude",
    label: "Claude Desktop",
    wakeKind: "mcp_events",
    wakeHost: "relay.ana.cl",
  },
  {
    userId: "usr_bob",
    agentId: "agt_openclaw",
    label: "OpenClaw",
    wakeKind: "openclaw_hooks",
    wakeHost: "claw.salinas.cl",
  },
  {
    userId: "usr_carla",
    agentId: "agt_grok",
    label: "Grok",
    wakeKind: "grokbot_routine",
    wakeHost: "routines.grok.x.ai",
    failing: true,
  },
  {
    userId: "usr_carla",
    agentId: "agt_old",
    label: "Webhook antiguo",
    wakeKind: "standard_webhook",
    wakeHost: "hooks.carla.dev",
    revoked: true,
  },
  {
    userId: "usr_tomas",
    agentId: "agt_manual",
    label: "Sin aviso (manual)",
    wakeKind: "none",
    wakeHost: null,
  },
]

export const agentsByUser = (userId: string) =>
  agentSeeds.filter((a) => a.userId === userId)
const personByUser = new Map(people.map((p) => [p.userId, p]))
const personByAddress = new Map(people.map((p) => [p.address, p]))
export const findPerson = (idOrAddress: string) =>
  personByUser.get(idOrAddress) ?? personByAddress.get(idOrAddress)

// ---------- solicitudes ----------

const rules = [
  "circle:amigos",
  "circle:trabajo",
  "person",
  "public_profile",
  "default:ask_owner",
  "blocked",
] as const
const fieldsByTool: Record<ToolName, string[]> = {
  profile: ["displayName", "headline"],
  availability: ["available", "freeSlots"],
  question: ["answer"],
  interest_check: ["matches"],
  connect: ["accepted"],
}
const argsKeysByTool: Record<ToolName, string[]> = {
  profile: [],
  availability: ["date", "start", "durationMinutes", "timezone"],
  question: ["text"],
  interest_check: ["interest"],
  connect: [],
}

type StatusPlan = { status: RequestStatus; count: number }
const plan: StatusPlan[] = [
  { status: "answered", count: 34 },
  { status: "no_data", count: 6 },
  { status: "declined", count: 5 },
  { status: "denied", count: 7 },
  { status: "expired", count: 5 },
  { status: "delivery_failed", count: 5 },
  { status: "awaiting_agent", count: 6 },
  { status: "awaiting_owner", count: 4 },
]

type RequestRecord = {
  summary: RequestSummary
  detail: RequestDetail
  payload: { args: unknown; purpose: string | null; result: unknown }
}

export const TRACE_REQUEST_ID = "req_7h2k9d4m1q"
export const TRACE_ID = "4bf92f3577b34da6a3ce929d0e0e4736"
export const FEATURED_ERROR_ID = "e3b0c442-98fc-4c1c-9afb-f4c8996fb924"

function agoSpread(i: number, total: number) {
  // Más densidad en la última hora: la mitad cae en 60 min y el resto en 24 h.
  if (i % 2 === 0) return between(1, 58) * MIN + between(0, 59) * 1000
  return between(1, 23) * HOUR + between(0, 59) * MIN + (i / total) * MIN
}

function samplePayload(tool: ToolName, status: RequestStatus) {
  const answered = status === "answered"
  switch (tool) {
    case "availability":
      return {
        args: {
          date: "2026-11-24",
          start: "16:00",
          durationMinutes: 45,
          timezone: "America/Santiago",
        },
        purpose: "Coordinar la demo del viernes",
        result: answered
          ? { available: true, freeSlots: ["16:00-17:30"] }
          : null,
      }
    case "question":
      return {
        args: { text: "¿Vas a llegar al after de la hackatón?" },
        purpose: null,
        result: answered ? { answer: "Sí, llego tipo 20:00." } : null,
      }
    case "interest_check":
      return {
        args: { interest: "cerámica" },
        purpose: "Armar un taller",
        result: answered ? { matches: true } : null,
      }
    case "connect":
      return {
        args: {},
        purpose: null,
        result: answered ? { accepted: true } : null,
      }
    case "profile":
      return {
        args: {},
        purpose: null,
        result: answered
          ? { displayName: "Diego Rojas", headline: "Backend en Fintual" }
          : null,
      }
  }
}

const attempt2Gap = (attempts: number) => (attempts + 1) * 30_000

function buildRequest(
  id: string,
  status: RequestStatus,
  createdAgo: number,
  overrides: Partial<RequestSummary> = {}
): RequestRecord {
  const from = pick(people.slice(0, 7))
  let to = pick(people)
  while (to.userId === from.userId) to = pick(people)
  const tool: ToolName = pick([
    "availability",
    "availability",
    "question",
    "interest_check",
    "profile",
  ] as const)
  const final = !status.startsWith("awaiting")
  const outcome = final ? (status as FinalOutcome) : null
  const targetAgents = agentsByUser(to.userId).filter((a) => !a.revoked)
  const grok = targetAgents.find((a) => a.wakeKind === "grokbot_routine")
  const target =
    status === "delivery_failed" ? (grok ?? targetAgents[0]) : targetAgents[0]
  const createdMs = NOW - createdAgo
  const ttl = 10 * MIN
  const stuck = !final && createdAgo > ttl
  const wakeKind = target?.wakeKind ?? "none"
  const failingWake =
    status === "delivery_failed" || (target?.failing && status !== "answered")
  const wakeAttempts =
    wakeKind === "none" || status === "denied"
      ? 0
      : failingWake
        ? 3
        : between(1, 2)
  // Intentos de aviso: 40 ms, +30 s, +60 s…
  const wakeOffsets = Array.from(
    { length: wakeAttempts },
    (_, i) => 40 + (i * (i + 1) * 30_000) / 2
  )
  const lastWake = wakeOffsets.at(-1) ?? 0
  const baseDuration =
    status === "expired"
      ? ttl
      : status === "denied"
        ? between(30, 90)
        : between(1_800, 42_000)
  const durationMs = final
    ? Math.max(
        200,
        Math.min(Math.max(baseDuration, lastWake + 600), createdAgo - 1_000)
      )
    : null
  const rule =
    status === "denied"
      ? pick(["blocked", "default:ask_owner"] as const)
      : status === "awaiting_owner"
        ? "default:ask_owner"
        : pick(rules.slice(0, 4))

  const summary: RequestSummary = {
    id,
    tool,
    fromAddress: from.address,
    toAddress: to.address,
    status,
    outcome,
    rule,
    escalated: status === "awaiting_owner" || (final && rand() < 0.15),
    targetAgentId: target?.agentId ?? null,
    answeredByAgentId: status === "answered" ? (target?.agentId ?? null) : null,
    wakeAttempts,
    lastWakeOk: wakeAttempts === 0 ? null : !failingWake,
    createdAt: isoAt(createdMs),
    expiresAt: isoAt(createdMs + ttl),
    closedAt: durationMs === null ? null : isoAt(createdMs + durationMs),
    durationMs,
    stuck,
    ...overrides,
  }

  const traceId = id === TRACE_REQUEST_ID ? TRACE_ID : hex(32)
  const timeline: TimelineItem[] = []
  const wakes: WakeJobRow[] = []
  const push = (
    offset: number,
    item: Omit<TimelineItem, "at" | "attrs"> & { attrs?: TimelineItem["attrs"] }
  ) => timeline.push({ at: isoAt(createdMs + offset), attrs: {}, ...item })

  push(0, {
    source: "telemetry",
    kind: "tool",
    name: "mcp.tool.call",
    service: "mcp",
    status: "ok",
    level: "info",
    durationMs: 38,
    traceId,
    errorId: null,
    attrs: { tool: `ask_${tool}`, outcome: "ok" },
  })
  push(12, {
    source: "telemetry",
    kind: "policy",
    name: "broker.policy.evaluated",
    service: "broker",
    status: null,
    level: "info",
    durationMs: 4,
    traceId,
    errorId: null,
    attrs: {
      tool,
      decision:
        status === "denied"
          ? "deny"
          : status === "awaiting_owner"
            ? "ask_owner"
            : "allow",
      rule: summary.rule,
    },
  })
  push(18, {
    source: "request_event",
    kind: "created",
    name: "created",
    service: null,
    status: "awaiting_agent",
    level: "info",
    durationMs: null,
    traceId: null,
    errorId: null,
  })

  for (let attempt = 1; attempt <= wakeAttempts; attempt++) {
    const t = wakeOffsets[attempt - 1]!
    const ok =
      !failingWake ||
      (attempt === wakeAttempts &&
        status !== "delivery_failed" &&
        !target?.failing)
    const httpStatus = ok ? 202 : pick([504, 502, 429])
    const code = ok ? null : httpStatus === 429 ? "rate_limited" : "timeout"
    push(t, {
      source: "telemetry",
      kind: "wake",
      name: "wake.attempt",
      service: "worker",
      status: ok ? "ok" : "error",
      level: ok ? "info" : "warn",
      durationMs: ok ? between(120, 900) : 10_000,
      traceId,
      errorId: null,
      attrs: { kind: wakeKind, attempt, ok, httpStatus, code },
    })
    wakes.push({
      id: shortId("wj_", 8),
      requestId: id,
      attempt,
      state: "done",
      runAt: isoAt(createdMs + t),
      kind: wakeKind,
      ok,
      httpStatus,
      code,
    })
  }
  const t = lastWake + attempt2Gap(wakeAttempts)
  if (!final && wakeKind !== "none" && status === "awaiting_agent") {
    wakes.push({
      id: shortId("wj_", 8),
      requestId: id,
      attempt: wakeAttempts + 1,
      state: stuck ? "queued" : "running",
      runAt: isoAt(createdMs + t),
      kind: wakeKind,
      ok: null,
      httpStatus: null,
      code: null,
    })
  }
  if (status === "delivery_failed") {
    push(t, {
      source: "telemetry",
      kind: "wake",
      name: "wake.exhausted",
      service: "worker",
      status: "error",
      level: "error",
      durationMs: null,
      traceId,
      errorId: null,
      attrs: { kind: wakeKind, attempts: wakeAttempts },
    })
  }
  if (status === "awaiting_owner") {
    push(30, {
      source: "request_event",
      kind: "status_changed",
      name: "status_changed",
      service: null,
      status: "awaiting_owner",
      level: "info",
      durationMs: null,
      traceId: null,
      errorId: null,
      attrs: { code: "escalated" },
    })
  }
  if (final && durationMs !== null) {
    if (status === "answered" && rand() < 0.2) {
      const errorId = uuid()
      push(durationMs - 800, {
        source: "telemetry",
        kind: "lifecycle",
        name: "broker.reply.rejected",
        service: "broker",
        status: "error",
        level: "warn",
        durationMs: null,
        traceId,
        errorId,
        attrs: { code: "schema" },
      })
    }
    push(durationMs - 20, {
      source: "telemetry",
      kind: "lifecycle",
      name: "broker.request.status_changed",
      service: "broker",
      status,
      level: "info",
      durationMs: null,
      traceId,
      errorId: null,
      attrs: {
        from: "awaiting_agent",
        to: status,
        by:
          status === "expired"
            ? "broker"
            : status === "denied"
              ? "broker"
              : "agent",
      },
    })
    push(durationMs, {
      source: "request_event",
      kind: "closed",
      name: "closed",
      service: null,
      status,
      level: status === "answered" || status === "no_data" ? "info" : "warn",
      durationMs: null,
      traceId: null,
      errorId: null,
      attrs: { code: outcome },
    })
  }
  timeline.sort((a, b) => a.at.localeCompare(b.at))

  const allowed =
    status === "answered"
      ? fieldsByTool[tool]
      : status === "no_data"
        ? fieldsByTool[tool].slice(0, 1)
        : []
  const dropped =
    status === "answered" &&
    tool === "availability" &&
    summary.rule === "circle:trabajo"
      ? ["freeSlots"]
      : []
  const detail: RequestDetail = {
    summary,
    allowedFields: allowed.filter((f) => !dropped.includes(f)),
    droppedFields: dropped,
    decisionReason:
      status === "denied"
        ? summary.rule === "blocked"
          ? "Remitente bloqueado por el dueño."
          : "Regla por defecto: denegar a desconocidos."
        : status === "declined"
          ? "El dueño rechazó la solicitud."
          : null,
    internalReason:
      status === "declined" ? "No comparte agenda fuera del trabajo" : null,
    argsKeys: argsKeysByTool[tool],
    resultKeys:
      status === "answered" ? allowed.filter((f) => !dropped.includes(f)) : [],
    hasPurpose: tool === "availability" || tool === "interest_check",
    responseSigned: status === "answered",
    timeline,
    wakes,
    traceIds: [traceId],
  }
  return { summary, detail, payload: samplePayload(tool, status) }
}

function buildRequests(): RequestRecord[] {
  const total = plan.reduce((sum, p) => sum + p.count, 0)
  const out: RequestRecord[] = []
  let i = 0
  for (const { status, count } of plan) {
    for (let n = 0; n < count; n++, i++) {
      let ago = agoSpread(i, total)
      if (status === "awaiting_agent" || status === "awaiting_owner") {
        // Dos atascadas (más viejas que el TTL) y el resto recientes.
        ago =
          n < 2 && status === "awaiting_agent"
            ? between(14, 40) * MIN
            : n === 0
              ? between(18, 25) * MIN
              : between(1, 8) * MIN
      }
      if (status === "expired" && ago < 12 * MIN) ago += 15 * MIN
      out.push(buildRequest(shortId("req_"), status, ago))
    }
  }
  // La solicitud de la traza de ejemplo: availability de Simón a Diego, contestada.
  const special = buildRequest(TRACE_REQUEST_ID, "answered", 7 * MIN, {})
  special.summary.fromAddress = "simon@nexo.app"
  special.summary.toAddress = "ana@nexo.app"
  special.summary.tool = "availability"
  special.summary.targetAgentId = "agt_claude"
  special.summary.answeredByAgentId = "agt_claude"
  special.summary.rule = "circle:amigos"
  special.summary.wakeAttempts = 1
  special.summary.lastWakeOk = true
  special.summary.durationMs = 6_420
  special.summary.closedAt = isoAt(NOW - 7 * MIN + 6_420)
  special.detail.argsKeys = argsKeysByTool.availability
  special.detail.allowedFields = ["available", "freeSlots"]
  special.detail.resultKeys = ["available", "freeSlots"]
  special.detail.hasPurpose = true
  special.payload = samplePayload("availability", "answered")
  const start = NOW - 7 * MIN
  const at = (ms: number) => isoAt(start + ms)
  special.detail.timeline = [
    {
      at: at(14),
      source: "telemetry",
      kind: "tool",
      name: "mcp.tool.call",
      service: "mcp",
      status: "ok",
      level: "info",
      durationMs: 6_390,
      traceId: TRACE_ID,
      errorId: null,
      attrs: { tool: "ask_contact", outcome: "ok" },
    },
    {
      at: at(28),
      source: "telemetry",
      kind: "policy",
      name: "broker.policy.evaluated",
      service: "broker",
      status: null,
      level: "info",
      durationMs: 5,
      traceId: TRACE_ID,
      errorId: null,
      attrs: { tool: "availability", decision: "allow", rule: "circle:amigos" },
    },
    {
      at: at(66),
      source: "request_event",
      kind: "created",
      name: "created",
      service: null,
      status: "awaiting_agent",
      level: "info",
      durationMs: null,
      traceId: null,
      errorId: null,
      attrs: {},
    },
    {
      at: at(140),
      source: "telemetry",
      kind: "wake",
      name: "wake.attempt",
      service: "worker",
      status: "ok",
      level: "info",
      durationMs: 418,
      traceId: TRACE_ID,
      errorId: null,
      attrs: {
        kind: "mcp_events",
        attempt: 1,
        ok: true,
        httpStatus: 202,
        code: null,
      },
    },
    {
      at: at(5_870),
      source: "telemetry",
      kind: "lifecycle",
      name: "broker.reply.rejected",
      service: "broker",
      status: "error",
      level: "warn",
      durationMs: 74,
      traceId: TRACE_ID,
      errorId: FEATURED_ERROR_ID,
      attrs: { code: "schema" },
    },
    {
      at: at(6_290),
      source: "telemetry",
      kind: "lifecycle",
      name: "broker.request.status_changed",
      service: "broker",
      status: "answered",
      level: "info",
      durationMs: null,
      traceId: TRACE_ID,
      errorId: null,
      attrs: { from: "awaiting_agent", to: "answered", by: "agent" },
    },
    {
      at: at(6_296),
      source: "request_event",
      kind: "closed",
      name: "closed",
      service: null,
      status: "answered",
      level: "info",
      durationMs: null,
      traceId: null,
      errorId: null,
      attrs: { code: "answered" },
    },
  ]
  special.detail.wakes = [
    {
      id: "wj_m4k2p9q1",
      requestId: TRACE_REQUEST_ID,
      attempt: 1,
      state: "done",
      runAt: at(140),
      kind: "mcp_events",
      ok: true,
      httpStatus: 202,
      code: null,
    },
  ]
  out.push(special)
  return out.sort((a, b) =>
    b.summary.createdAt.localeCompare(a.summary.createdAt)
  )
}

export const requests: RequestRecord[] = buildRequests()

// ---------- trazas ----------

function span(
  traceStart: number,
  spec: {
    id: string
    parent: string | null
    service: Service
    name: string
    offset: number
    duration: number
    status?: string
    level?: TelemetryEvent["level"]
    attrs?: Record<string, string | number | boolean | null>
    errorId?: string
  }
) {
  return {
    spanId: spec.id,
    parentSpanId: spec.parent,
    service: spec.service,
    name: spec.name,
    startAt: isoAt(traceStart + spec.offset),
    durationMs: spec.duration,
    status: spec.status ?? "ok",
    level: spec.level ?? "info",
    requestId: TRACE_REQUEST_ID,
    errorId: spec.errorId ?? null,
    attrs: spec.attrs ?? {},
  }
}

export function buildFeaturedTrace(): Trace {
  const start = NOW - 7 * MIN
  return {
    traceId: TRACE_ID,
    spans: [
      span(start, {
        id: "a1f0c2d3e4b5a601",
        parent: null,
        service: "mcp",
        name: "http.request POST /mcp",
        offset: 0,
        duration: 6_420,
        attrs: { method: "POST", route: "/mcp", status: 200 },
      }),
      span(start, {
        id: "a1f0c2d3e4b5a602",
        parent: "a1f0c2d3e4b5a601",
        service: "mcp",
        name: "auth.token.verified",
        offset: 3,
        duration: 9,
        attrs: { issuer: "web" },
      }),
      span(start, {
        id: "a1f0c2d3e4b5a603",
        parent: "a1f0c2d3e4b5a601",
        service: "mcp",
        name: "mcp.tool.call ask_contact",
        offset: 14,
        duration: 6_390,
        attrs: { tool: "ask_contact", outcome: "ok" },
      }),
      span(start, {
        id: "b2e1d3c4f5a6b701",
        parent: "a1f0c2d3e4b5a603",
        service: "broker",
        name: "http.request POST /v1/agent/ask",
        offset: 22,
        duration: 61,
        attrs: { method: "POST", route: "/v1/agent/ask", status: 201 },
      }),
      span(start, {
        id: "b2e1d3c4f5a6b702",
        parent: "b2e1d3c4f5a6b701",
        service: "broker",
        name: "auth.service_jwt.verified",
        offset: 24,
        duration: 2,
        attrs: { expectedIss: "mcp" },
      }),
      span(start, {
        id: "b2e1d3c4f5a6b703",
        parent: "b2e1d3c4f5a6b701",
        service: "broker",
        name: "broker.policy.evaluated",
        offset: 28,
        duration: 5,
        attrs: {
          tool: "availability",
          decision: "allow",
          rule: "circle:amigos",
        },
      }),
      span(start, {
        id: "b2e1d3c4f5a6b704",
        parent: "b2e1d3c4f5a6b701",
        service: "broker",
        name: "pg insert nexo.requests",
        offset: 35,
        duration: 31,
        attrs: {},
      }),
      span(start, {
        id: "c3d2e4f5a6b7c801",
        parent: "b2e1d3c4f5a6b701",
        service: "worker",
        name: "wake.attempt mcp_events",
        offset: 140,
        duration: 418,
        attrs: { kind: "mcp_events", attempt: 1, ok: true, httpStatus: 202 },
      }),
      span(start, {
        id: "c3d2e4f5a6b7c802",
        parent: "c3d2e4f5a6b7c801",
        service: "worker",
        name: "http POST relay.ana.cl",
        offset: 150,
        duration: 396,
        attrs: { status: 202 },
      }),
      span(start, {
        id: "a1f0c2d3e4b5a604",
        parent: "a1f0c2d3e4b5a603",
        service: "mcp",
        name: "await_contact (long poll)",
        offset: 95,
        duration: 6_300,
        attrs: { tool: "await_contact" },
      }),
      span(start, {
        id: "b2e1d3c4f5a6b705",
        parent: "a1f0c2d3e4b5a604",
        service: "broker",
        name: "http.request POST /v1/agent/reply",
        offset: 5_870,
        duration: 74,
        status: "error",
        level: "warn",
        errorId: FEATURED_ERROR_ID,
        attrs: { method: "POST", route: "/v1/agent/reply", status: 422 },
      }),
      span(start, {
        id: "b2e1d3c4f5a6b706",
        parent: "a1f0c2d3e4b5a604",
        service: "broker",
        name: "http.request POST /v1/agent/reply",
        offset: 6_210,
        duration: 88,
        attrs: { method: "POST", route: "/v1/agent/reply", status: 200 },
      }),
      span(start, {
        id: "b2e1d3c4f5a6b707",
        parent: "b2e1d3c4f5a6b706",
        service: "broker",
        name: "broker.request.closed",
        offset: 6_290,
        duration: 6,
        attrs: { outcome: "answered", escalated: false },
      }),
    ],
  }
}

// Traza genérica para cualquier otra solicitud, armada desde su línea de tiempo.
export function buildTraceFor(traceId: string): Trace | null {
  if (traceId === TRACE_ID) return buildFeaturedTrace()
  const record = requests.find((r) => r.detail.traceIds.includes(traceId))
  if (!record) return null
  const start = Date.parse(record.summary.createdAt)
  const total = record.summary.durationMs ?? Math.min(NOW - start, 10 * MIN)
  const root = hex(16)
  const spans: Trace["spans"] = [
    {
      spanId: root,
      parentSpanId: null,
      service: "mcp",
      name: "mcp.tool.call ask_contact",
      startAt: isoAt(start),
      durationMs: total,
      status:
        record.summary.status === "answered" ? "ok" : record.summary.status,
      level: "info",
      requestId: record.summary.id,
      errorId: null,
      attrs: { tool: "ask_contact" },
    },
  ]
  const brokerId = hex(16)
  spans.push({
    spanId: brokerId,
    parentSpanId: root,
    service: "broker",
    name: "http.request POST /v1/agent/ask",
    startAt: isoAt(start + 8),
    durationMs: between(30, 90),
    status: "ok",
    level: "info",
    requestId: record.summary.id,
    errorId: null,
    attrs: { route: "/v1/agent/ask", status: 201 },
  })
  for (const item of record.detail.timeline.filter(
    (i) => i.source === "telemetry" && i.name !== "mcp.tool.call"
  )) {
    spans.push({
      spanId: hex(16),
      parentSpanId: item.service === "worker" ? brokerId : root,
      service: item.service ?? "broker",
      name: item.name,
      startAt: item.at,
      durationMs: item.durationMs ?? 3,
      status: item.status,
      level: item.level,
      requestId: record.summary.id,
      errorId: item.errorId,
      attrs: item.attrs,
    })
  }
  return { traceId, spans }
}

// ---------- errores ----------

type ErrorSeed = {
  service: Service
  operation: string
  type: string
  count: number
  firstAgo: number
  lastAgo: number
  frames: string
  issues?: string
}

const errorSeeds: ErrorSeed[] = [
  {
    service: "broker",
    operation: "POST /v1/agent/reply",
    type: "TypeError",
    count: 3,
    firstAgo: 52 * MIN,
    lastAgo: 7 * MIN,
    frames:
      "at parseReply (packages/broker/src/core/reply.ts:88:17)\nat AgentPort.reply (packages/broker/src/core/agent.ts:142:11)\nat apps/broker/src/http/server.ts:211:24",
    issues: "result.freeSlots[0]: formato inválido",
  },
  {
    service: "worker",
    operation: "wake.grokbot_routine",
    type: "WakeTimeoutError",
    count: 14,
    firstAgo: 5 * HOUR,
    lastAgo: 2 * MIN,
    frames:
      "at GrokbotWaker.wake (packages/wake/src/grokbot.ts:57:13)\nat runWakeJob (apps/broker/src/worker/wake.ts:96:22)",
  },
  {
    service: "mcp",
    operation: "tool.ask_contact",
    type: "ZodError",
    count: 5,
    firstAgo: 3 * HOUR,
    lastAgo: 38 * MIN,
    frames:
      "at AskInput.parse (packages/protocol/src/request.ts:14:3)\nat askContact (apps/mcp/src/tools/ask.ts:41:19)",
    issues: "args.durationMinutes: debe ser ≥ 15",
  },
  {
    service: "web",
    operation: "GET /api/auth/oauth2/callback",
    type: "OAuthStateMismatch",
    count: 2,
    firstAgo: 9 * HOUR,
    lastAgo: 4 * HOUR,
    frames: "at verifyState (apps/web/src/lib/auth.ts:212:9)",
  },
  {
    service: "coordination",
    operation: "POST /tools/await_contact",
    type: "PgQueryTimeout",
    count: 1,
    firstAgo: 70 * MIN,
    lastAgo: 70 * MIN,
    frames:
      "at awaitContact (apps/server/src/tools/await.ts:63:15)\nat pool.query (apps/server/src/db.ts:28:10)",
  },
  {
    service: "broker",
    operation: "sweep.expire",
    type: "SerializationFailure",
    count: 4,
    firstAgo: 20 * HOUR,
    lastAgo: 11 * HOUR,
    frames: "at sweepExpired (packages/broker/src/core/sweep.ts:31:7)",
  },
]

export const errors: ErrorGroup[] = errorSeeds.map((seed, i) => ({
  service: seed.service,
  operation: seed.operation,
  type: seed.type,
  count: seed.count,
  firstAt: iso(seed.firstAgo),
  lastAt: iso(seed.lastAgo),
  sampleErrorId: i === 0 ? FEATURED_ERROR_ID : uuid(),
}))

export const errorEvents: TelemetryEvent[] = errorSeeds.map((seed, i) => {
  const group = errors[i]!
  const related =
    seed.service === "broker" && i === 0
      ? requests.find((r) => r.summary.id === TRACE_REQUEST_ID)
      : seed.service === "worker"
        ? requests.find((r) => r.summary.status === "delivery_failed")
        : undefined
  return {
    id: nextEventId(),
    at: group.lastAt,
    service: seed.service,
    kind: "error",
    name: "error",
    level: "error",
    traceId: related?.detail.traceIds[0] ?? hex(32),
    spanId: hex(16),
    parentSpanId: hex(16),
    requestId: related?.summary.id ?? null,
    userId: related
      ? (findPerson(related.summary.toAddress)?.userId ?? null)
      : null,
    agentId: related?.summary.targetAgentId ?? null,
    durationMs: null,
    status: "error",
    errorId: group.sampleErrorId,
    attrs: {
      operation: seed.operation,
      type: seed.type,
      issues: seed.issues ?? null,
      frames: seed.frames,
    },
  }
})

// ---------- salud de servicios ----------

export function services(): ServiceHealth[] {
  const at = Date.now()
  const seen = (ago: number) => new Date(at - ago).toISOString()
  return [
    {
      service: "web",
      instance: "web-7d9f:1",
      version: "0.4.2",
      lastSeenAt: seen(12_000),
      state: "up",
    },
    {
      service: "mcp",
      instance: "mcp-5c1a:1",
      version: "0.4.2",
      lastSeenAt: seen(8_000),
      state: "up",
    },
    {
      service: "mcp",
      instance: "mcp-5c1a:2",
      version: "0.4.2",
      lastSeenAt: seen(21_000),
      state: "up",
    },
    {
      service: "broker",
      instance: "broker-2b8e:1",
      version: "0.4.1",
      lastSeenAt: seen(4_000),
      state: "up",
    },
    {
      service: "worker",
      instance: "broker-2b8e:worker",
      version: "0.4.1",
      lastSeenAt: seen(132_000),
      state: "stale",
    },
    {
      service: "admin",
      instance: "admin-91aa:1",
      version: "0.1.0",
      lastSeenAt: seen(15_000),
      state: "up",
    },
    {
      service: "coordination",
      instance: "coord-3f0d:1",
      version: "0.3.0",
      lastSeenAt: seen(27_000),
      state: "up",
    },
  ]
}

// ---------- agentes y personas ----------

export function agentRows(): AgentRow[] {
  return agentSeeds.map((seed) => {
    const person = personByUser.get(seed.userId)!
    return {
      userId: seed.userId,
      agentId: seed.agentId,
      label: seed.label,
      wakeKind: seed.wakeKind,
      wakeHost: seed.wakeHost,
      verifiedAt:
        seed.wakeKind === "none" ? null : iso(person.createdAgo - HOUR),
      lastWakeAt:
        seed.wakeKind === "none"
          ? null
          : iso(
              seed.revoked
                ? 27 * HOUR
                : seed.failing
                  ? 2 * MIN
                  : between(3, 90) * MIN
            ),
      revokedAt: seed.revoked ? iso(26 * HOUR) : null,
      createdAt: iso(person.createdAgo - 30 * MIN),
      wakes24h:
        seed.wakeKind === "none" || seed.revoked
          ? { ok: 0, failed: 0 }
          : seed.failing
            ? { ok: between(0, 2), failed: between(9, 16) }
            : { ok: between(6, 40), failed: between(0, 1) },
    }
  })
}

export function userSummaries(): UserSummary[] {
  return people.map((p) => {
    const sent = requests.filter((r) => r.summary.fromAddress === p.address)
    const received = requests.filter((r) => r.summary.toAddress === p.address)
    const last =
      [...sent, ...received]
        .map((r) => r.summary.createdAt)
        .sort()
        .at(-1) ?? null
    return {
      userId: p.userId,
      address: p.address,
      displayName: p.displayName ?? null,
      createdAt: iso(p.createdAgo),
      agents: agentsByUser(p.userId).filter((a) => !a.revoked).length,
      sent24h: sent.length,
      received24h: received.length,
      lastActivityAt: last,
    }
  })
}

export function rulesFor(address: string) {
  const others = people
    .filter((p) => p.address !== address)
    .map((p) => p.address)
  return {
    publicProfile: { displayName: findPerson(address)?.displayName ?? address },
    circles: { amigos: others.slice(0, 3), trabajo: others.slice(2, 5) },
    grants: {
      amigos: [
        {
          tool: "availability",
          fields: ["available", "freeSlots"],
          guidance: "",
          never: false,
        },
      ],
      trabajo: [
        {
          tool: "availability",
          fields: ["available"],
          guidance: "",
          never: false,
        },
        {
          tool: "question",
          fields: ["answer"],
          guidance: "Solo temas de trabajo",
          never: false,
        },
      ],
    },
    people: {},
    blocked: address === "carla@nexo.app" ? ["eva@nexo.app"] : [],
    defaultForUnknown: "ask_owner",
  }
}

// ---------- telemetría histórica ----------

export function historyEvents(): TelemetryEvent[] {
  const out: TelemetryEvent[] = []
  for (const record of requests.slice(0, 40)) {
    for (const item of record.detail.timeline) {
      if (item.source !== "telemetry" || !item.service) continue
      out.push({
        id: nextEventId(),
        at: item.at,
        service: item.service,
        kind: item.kind as TelemetryEvent["kind"],
        name: item.name,
        level: item.level,
        traceId: item.traceId,
        spanId: hex(16),
        parentSpanId: null,
        requestId: record.summary.id,
        userId: findPerson(record.summary.toAddress)?.userId ?? null,
        agentId: record.summary.targetAgentId,
        durationMs: item.durationMs,
        status: item.status,
        errorId: item.errorId,
        attrs: item.attrs,
      })
    }
  }
  out.push(...errorEvents)
  return out.sort((a, b) => b.at.localeCompare(a.at))
}

// ---------- auditoría y tokens ----------

const auditSeeds: Array<Omit<AuditEntry, "id" | "at"> & { ago: number }> = [
  {
    ago: 3 * MIN,
    actorType: "token",
    actorId: "tok_claude",
    actorLabel: "Claude Code · simon",
    action: "admin.mcp.call",
    target: "admin_get_request",
    reason: null,
    ip: "190.45.12.8",
  },
  {
    ago: 6 * MIN,
    actorType: "admin",
    actorId: "adm_simon",
    actorLabel: "simon@platan.us",
    action: "admin.reveal",
    target: TRACE_REQUEST_ID,
    reason: "Ana reporta que el horario devuelto no coincide con su agenda",
    ip: "190.45.12.8",
  },
  {
    ago: 11 * MIN,
    actorType: "admin",
    actorId: "adm_simon",
    actorLabel: "simon@platan.us",
    action: "admin.action",
    target: "rewake " + requests[3]!.summary.id,
    reason: "Reintento tras arreglar el relay de Diego",
    ip: "190.45.12.8",
  },
  {
    ago: 24 * MIN,
    actorType: "token",
    actorId: "tok_codex",
    actorLabel: "Codex · adolfo",
    action: "admin.mcp.call",
    target: "admin_overview",
    reason: null,
    ip: "200.73.101.44",
  },
  {
    ago: 42 * MIN,
    actorType: "admin",
    actorId: "adm_adolfo",
    actorLabel: "adolfo@platan.us",
    action: "admin.action",
    target: "expire " + requests[9]!.summary.id,
    reason: "Solicitud atascada: el barrido estaba caído",
    ip: "200.73.101.44",
  },
  {
    ago: 70 * MIN,
    actorType: "admin",
    actorId: "adm_adolfo",
    actorLabel: "adolfo@platan.us",
    action: "admin.token.created",
    target: "tok_codex",
    reason: null,
    ip: "200.73.101.44",
  },
  {
    ago: 2 * HOUR,
    actorType: "admin",
    actorId: "adm_simon",
    actorLabel: "simon@platan.us",
    action: "admin.action",
    target: "revoke usr_carla/agt_old",
    reason: "Webhook antiguo devolvía 410 en cada aviso",
    ip: "190.45.12.8",
  },
  {
    ago: 3 * HOUR,
    actorType: "admin",
    actorId: "adm_diego",
    actorLabel: "diego@platan.us",
    action: "admin.login",
    target: null,
    reason: null,
    ip: "181.43.2.19",
  },
  {
    ago: 5 * HOUR,
    actorType: "admin",
    actorId: "adm_simon",
    actorLabel: "simon@platan.us",
    action: "admin.token.revoked",
    target: "tok_old",
    reason: null,
    ip: "190.45.12.8",
  },
  {
    ago: 26 * HOUR,
    actorType: "admin",
    actorId: "adm_simon",
    actorLabel: "simon@platan.us",
    action: "admin.login",
    target: null,
    reason: null,
    ip: "190.45.12.8",
  },
]

export const audit: AuditEntry[] = [
  ...auditSeeds.map(({ ago, ...rest }) => ({
    id: shortId("aud_", 8),
    at: iso(ago),
    ...rest,
  })),
  ...Array.from({ length: 30 }, (_, i): AuditEntry => ({
    id: shortId("aud_", 8),
    at: iso(27 * HOUR + i * 47 * MIN),
    actorType: i % 3 === 0 ? "admin" : "token",
    actorId: i % 3 === 0 ? "adm_simon" : "tok_claude",
    actorLabel: i % 3 === 0 ? "simon@platan.us" : "Claude Code · simon",
    action: i % 3 === 0 ? "admin.login" : "admin.mcp.call",
    target:
      i % 3 === 0
        ? null
        : pick([
            "admin_overview",
            "admin_search_requests",
            "admin_get_trace",
            "admin_errors",
          ]),
    reason: null,
    ip: "190.45.12.8",
  })),
]

export const tokens: AdminToken[] = [
  {
    id: "tok_claude",
    name: "Claude Code · simon",
    prefix: "nxa_k3P9xQ2m",
    scopes: ["admin:read", "admin:sql"],
    createdBy: "simon@platan.us",
    createdAt: iso(2 * 24 * HOUR),
    expiresAt: iso(-5 * 24 * HOUR),
    lastUsedAt: iso(3 * MIN),
    revokedAt: null,
  },
  {
    id: "tok_codex",
    name: "Codex · adolfo",
    prefix: "nxa_Vb71LmZa",
    scopes: ["admin:read"],
    createdBy: "adolfo@platan.us",
    createdAt: iso(70 * MIN),
    expiresAt: iso(-7 * 24 * HOUR + 70 * MIN),
    lastUsedAt: iso(24 * MIN),
    revokedAt: null,
  },
  {
    id: "tok_old",
    name: "Prueba MCP",
    prefix: "nxa_0aQe4RtY",
    scopes: ["admin:read"],
    createdBy: "simon@platan.us",
    createdAt: iso(4 * 24 * HOUR),
    expiresAt: iso(-3 * 24 * HOUR),
    lastUsedAt: iso(4 * 24 * HOUR - HOUR),
    revokedAt: iso(5 * HOUR),
  },
]
