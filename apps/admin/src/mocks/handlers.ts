// Servidor falso para VITE_ADMIN_MOCK=1. Implementa cada ruta de `adminRoutes` sobre las
// fixtures, con latencia simulada y las mismas reglas de rol, frescura y motivo que el real.
// La respuesta pasa por el mismo esquema zod que una respuesta real (ver lib/api.ts).
import {
  ADMIN_TOKEN_PREFIX,
  type AdminRouteName,
  type AdminSession,
  type AdminToken,
  type Overview,
  type RequestSummary,
  type Window,
} from "@shared/contract"
import { RequestStatus } from "@team-31/protocol"

import { ApiError } from "@/lib/api"
import {
  agentRows,
  audit,
  buildTraceFor,
  errorEvents,
  errors,
  findPerson,
  hex,
  historyEvents,
  requests,
  rulesFor,
  services,
  shortId,
  tokens,
  userSummaries,
} from "@/mocks/fixtures"

// ---------- estado simulado de la sesión ----------

export type MockState = {
  loggedIn: boolean
  role: "viewer" | "operator"
  fresh: boolean
}
const STORAGE_KEY = "sideband-admin-mock"
const defaults: MockState = { loggedIn: true, role: "operator", fresh: true }

export function readMockState(): MockState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw
      ? { ...defaults, ...(JSON.parse(raw) as Partial<MockState>) }
      : defaults
  } catch {
    return defaults
  }
}

export function writeMockState(patch: Partial<MockState>): MockState {
  const next = { ...readMockState(), ...patch }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // Sin almacenamiento: el estado vive solo en esta pestaña.
  }
  return next
}

const sessionStart = new Date(Date.now() - 4 * 60_000).toISOString()

function session(state: MockState): AdminSession {
  return {
    user: {
      id: "adm_dev",
      email: "dev@sideband.local",
      name: "Dev Sideband",
      image: null,
      role: state.role,
    },
    session: {
      id: "ses_mock",
      createdAt: sessionStart,
      expiresAt: new Date(Date.now() + 8 * 3_600_000).toISOString(),
      fresh: state.fresh,
    },
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export async function mockDevLogin() {
  await sleep(350)
  writeMockState({ loggedIn: true, fresh: true })
}

export async function mockSignOut() {
  await sleep(150)
  writeMockState({ loggedIn: false })
}

// ---------- utilidades ----------

const windowMs: Record<Window, number> = {
  "15m": 15 * 60_000,
  "1h": 3_600_000,
  "24h": 86_400_000,
  "7d": 7 * 86_400_000,
}

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[
    Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))
  ]!
}

function page<T>(items: T[], cursor: string | undefined, limit: number) {
  const start = cursor ? Number(cursor) : 0
  const slice = items.slice(start, start + limit)
  const next = start + limit < items.length ? String(start + limit) : null
  return { items: slice, nextCursor: next }
}

function requireReason(body: unknown) {
  const reason = (body as { reason?: unknown } | undefined)?.reason
  if (
    typeof reason !== "string" ||
    reason.trim().length < 10 ||
    reason.length > 500
  ) {
    throw new ApiError(
      "invalid_input",
      "El motivo debe tener entre 10 y 500 caracteres.",
      400
    )
  }
  return reason
}

function overview(window: Window): Overview {
  const since = Date.now() - windowMs[window]
  const inWindow = requests
    .filter((r) => Date.parse(r.summary.createdAt) >= since)
    .map((r) => r.summary)
  const byStatus = Object.fromEntries(
    RequestStatus.options.map((s) => [s, 0])
  ) as Overview["requests"]["byStatus"]
  const byTool: Record<string, number> = {}
  for (const r of inWindow) {
    byStatus[r.status] += 1
    byTool[r.tool] = (byTool[r.tool] ?? 0) + 1
  }
  const durations = inWindow.flatMap((r) =>
    r.durationMs === null ? [] : [r.durationMs]
  )
  const allOpen = requests
    .filter((r) => r.summary.status.startsWith("awaiting"))
    .map((r) => r.summary)
  const scale =
    window === "15m" ? 0.3 : window === "1h" ? 1 : window === "24h" ? 6 : 30
  const visibleErrors = errors.filter((e) => Date.parse(e.lastAt) >= since)
  return {
    window,
    generatedAt: new Date().toISOString(),
    services: services(),
    requests: {
      total: inWindow.length,
      open: allOpen.length,
      stuck: allOpen.filter((r) => r.stuck).length,
      byStatus,
      byTool,
      timeToFinalMs: {
        p50: percentile(durations, 50),
        p95: percentile(durations, 95),
      },
    },
    wakes: [
      {
        kind: "mcp_events",
        ok: Math.round(48 * scale),
        failed: Math.round(1 * scale),
        retried: Math.round(2 * scale),
        p95LatencyMs: 640,
      },
      {
        kind: "openclaw_hooks",
        ok: Math.round(31 * scale),
        failed: 0,
        retried: Math.round(1 * scale),
        p95LatencyMs: 410,
      },
      {
        kind: "standard_webhook",
        ok: Math.round(12 * scale),
        failed: Math.round(1 * scale),
        retried: Math.round(1 * scale),
        p95LatencyMs: 880,
      },
      {
        kind: "grokbot_routine",
        ok: Math.round(2 * scale),
        failed: Math.round(14 * scale),
        retried: Math.round(9 * scale),
        p95LatencyMs: 10_000,
      },
    ],
    errors: {
      total: visibleErrors.reduce((sum, e) => sum + e.count, 0),
      top: [...visibleErrors].sort((a, b) => b.count - a.count).slice(0, 5),
    },
    rateLimited: Math.round(3 * scale),
    activeQuotaWindows: Math.round(10 * scale),
  }
}

function filterRequests(query: Record<string, unknown>): RequestSummary[] {
  const status = query.status as string[] | string | undefined
  const statuses =
    status === undefined ? undefined : Array.isArray(status) ? status : [status]
  const address =
    typeof query.address === "string" ? query.address.toLowerCase() : undefined
  const q = typeof query.q === "string" ? query.q.toLowerCase() : undefined
  const since =
    typeof query.since === "string" ? Date.parse(query.since) : undefined
  return requests
    .map((r) => r.summary)
    .filter((r) => !statuses || statuses.includes(r.status))
    .filter((r) => !query.tool || r.tool === query.tool)
    .filter(
      (r) =>
        !address ||
        r.fromAddress.includes(address) ||
        r.toAddress.includes(address)
    )
    .filter((r) => !q || r.id.toLowerCase().startsWith(q))
    .filter((r) => !query.stuck || r.stuck)
    .filter((r) => since === undefined || Date.parse(r.createdAt) >= since)
}

// ---------- rutas ----------

type MockInput = {
  params?: Record<string, string>
  query?: Record<string, unknown>
  body?: unknown
}

export async function mockApi(
  name: AdminRouteName,
  input: MockInput
): Promise<unknown> {
  await sleep(120 + Math.random() * 260)
  const state = readMockState()
  if (!state.loggedIn) throw new ApiError("unauthorized", "Sin sesión.", 401)

  const params = input.params ?? {}
  const query = input.query ?? {}
  const operatorOnly = () => {
    if (state.role !== "operator")
      throw new ApiError("forbidden", "Requiere rol operator.", 403)
  }
  const freshOnly = () => {
    operatorOnly()
    if (!state.fresh)
      throw new ApiError(
        "not_fresh",
        "La acción exige una sesión reciente.",
        403
      )
  }
  const findRequest = () => {
    const record = requests.find((r) => r.summary.id === params.id)
    if (!record)
      throw new ApiError("not_found", "Solicitud no encontrada.", 404)
    return record
  }

  switch (name) {
    case "session":
      return session(state)
    case "overview":
      return overview((query.window as Window | undefined) ?? "1h")
    case "services":
      return { items: services() }
    case "requests": {
      const limit = Number(query.limit ?? 50)
      return page(
        filterRequests(query),
        query.cursor as string | undefined,
        limit
      )
    }
    case "request":
      return findRequest().detail
    case "revealPayload": {
      freshOnly()
      requireReason(input.body)
      const record = findRequest()
      const auditId = shortId("aud_", 8)
      return {
        requestId: record.summary.id,
        ...record.payload,
        auditId,
        revealedAt: new Date().toISOString(),
      }
    }
    case "rewake": {
      freshOnly()
      requireReason(input.body)
      const record = findRequest()
      if (record.summary.status !== "awaiting_agent")
        throw new ApiError(
          "invalid_input",
          "Solo se reintentan solicitudes en awaiting_agent.",
          409
        )
      const attempt = record.summary.wakeAttempts + 1
      const at = new Date().toISOString()
      record.summary.wakeAttempts = attempt
      record.detail.wakes = [
        ...record.detail.wakes.filter((w) => w.state === "done"),
        {
          id: shortId("wj_", 8),
          requestId: record.summary.id,
          attempt,
          state: "queued",
          runAt: at,
          kind: record.detail.wakes[0]?.kind ?? null,
          ok: null,
          httpStatus: null,
          code: null,
        },
      ]
      record.detail.timeline = [
        ...record.detail.timeline,
        {
          at,
          source: "request_event",
          kind: "admin_rewake",
          name: "admin_rewake",
          service: null,
          status: record.summary.status,
          level: "info",
          durationMs: null,
          traceId: null,
          errorId: null,
          attrs: { code: "admin_rewake" },
        },
      ]
      return { ok: true, auditId: shortId("aud_", 8) }
    }
    case "expire": {
      freshOnly()
      requireReason(input.body)
      const record = findRequest()
      if (!record.summary.status.startsWith("awaiting"))
        throw new ApiError(
          "invalid_input",
          "La solicitud ya está cerrada.",
          409
        )
      const at = new Date().toISOString()
      Object.assign(record.summary, {
        status: "expired",
        outcome: "expired",
        closedAt: at,
        stuck: false,
        durationMs: Date.now() - Date.parse(record.summary.createdAt),
      })
      record.detail.timeline = [
        ...record.detail.timeline,
        {
          at,
          source: "request_event",
          kind: "admin_expire",
          name: "admin_expire",
          service: null,
          status: "expired",
          level: "warn",
          durationMs: null,
          traceId: null,
          errorId: null,
          attrs: { code: "admin_expire" },
        },
      ]
      return { ok: true, auditId: shortId("aud_", 8) }
    }
    case "trace": {
      const trace = buildTraceFor(params.id ?? "")
      if (!trace) throw new ApiError("not_found", "Traza no encontrada.", 404)
      return trace
    }
    case "events": {
      const items = historyEvents()
        .filter((e) => !query.service || e.service === query.service)
        .filter((e) => !query.kind || e.kind === query.kind)
        .filter((e) => !query.level || e.level === query.level)
        .filter((e) => !query.requestId || e.requestId === query.requestId)
        .filter((e) => !query.traceId || e.traceId === query.traceId)
      return { items: items.slice(0, Number(query.limit ?? 100)) }
    }
    case "flowSnapshot":
      return {
        generatedAt: new Date().toISOString(),
        cursor: null,
        users: userSummaries().map(({ userId, address, displayName }) => ({
          userId,
          address,
          displayName,
        })),
        agents: agentRows().map(
          ({
            userId,
            agentId,
            label,
            wakeKind,
            verifiedAt,
            revokedAt,
            createdAt,
          }) => ({
            userId,
            agentId,
            label,
            wakeKind,
            verifiedAt,
            revokedAt,
            createdAt,
          })
        ),
        requests: requests.slice(0, 50).map(({ summary }) => ({
          id: summary.id,
          fromAddress: summary.fromAddress,
          toAddress: summary.toAddress,
          targetAgentId: summary.targetAgentId,
          answeredByAgentId: summary.answeredByAgentId,
          status: summary.status,
          createdAt: summary.createdAt,
        })),
        truncated: false,
      }
    case "flowLive":
    case "live":
      throw new ApiError(
        "invalid_input",
        "Usa subscribeLive para el stream.",
        400
      )
    case "errors": {
      const since =
        Date.now() - windowMs[(query.window as Window | undefined) ?? "24h"]
      return {
        items: errors
          .filter((e) => Date.parse(e.lastAt) >= since)
          .filter((e) => !query.service || e.service === query.service)
          .filter(
            (e) =>
              !query.operation || e.operation.includes(String(query.operation))
          ),
      }
    }
    case "error": {
      const event = errorEvents.find((e) => e.errorId === params.id)
      if (!event) throw new ApiError("not_found", "Error no encontrado.", 404)
      return event
    }
    case "users": {
      const q = typeof query.q === "string" ? query.q.toLowerCase() : ""
      const items = userSummaries().filter(
        (u) =>
          !q ||
          [u.userId, u.address ?? "", u.displayName ?? ""].some((v) =>
            v.toLowerCase().includes(q)
          )
      )
      return page(
        items,
        query.cursor as string | undefined,
        Number(query.limit ?? 50)
      )
    }
    case "user": {
      const person = findPerson(params.id ?? "")
      if (!person)
        throw new ApiError("not_found", "Persona no encontrada.", 404)
      const summary = userSummaries().find((u) => u.userId === person.userId)!
      return {
        summary,
        identity: {
          email: person.email,
          activeSessions:
            person.userId === "usr_eva" ? 0 : 1 + (person.userId.length % 3),
          oauthClients:
            person.userId === "usr_eva"
              ? []
              : [
                  {
                    clientId: "mcp_claude_" + person.userId.slice(4),
                    name: "Claude",
                    lastTokenAt: new Date(
                      Date.now() - 40 * 60_000
                    ).toISOString(),
                    activeTokens: 1,
                  },
                  ...(person.userId === "usr_simon"
                    ? [
                        {
                          clientId: "mcp_codex_simon",
                          name: "Codex CLI",
                          lastTokenAt: null,
                          activeTokens: 0,
                        },
                      ]
                    : []),
                ],
        },
        rules: rulesFor(person.address),
        agents: agentRows().filter((a) => a.userId === person.userId),
        recentRequests: requests
          .map((r) => r.summary)
          .filter(
            (r) =>
              r.fromAddress === person.address || r.toAddress === person.address
          )
          .slice(0, 12),
      }
    }
    case "agents":
      return {
        items: agentRows()
          .filter((a) => !query.failing || a.wakes24h.failed > a.wakes24h.ok)
          .filter((a) => !query.kind || a.wakeKind === query.kind),
      }
    case "revokeAgent":
      freshOnly()
      requireReason(input.body)
      return { ok: true, auditId: shortId("aud_", 8) }
    case "wakeQueue": {
      const items = requests
        .flatMap((r) => r.detail.wakes)
        .sort((a, b) => b.runAt.localeCompare(a.runAt))
      return {
        items: items
          .filter((w) => !query.state || w.state === query.state)
          .slice(0, 200),
      }
    }
    case "sql":
      operatorOnly()
      return {
        columns: ["status", "count"],
        rows: RequestStatus.options.map((s) => [
          s,
          requests.filter((r) => r.summary.status === s).length,
        ]),
        truncated: false,
        durationMs: 12,
      }
    case "audit":
      return page(audit, query.cursor as string | undefined, 20)
    case "tokens":
      operatorOnly()
      return { items: tokens }
    case "createToken": {
      freshOnly()
      const body = input.body as {
        name: string
        ttlDays?: number
        scopes?: AdminToken["scopes"]
      }
      if (!body?.name || body.name.length < 3)
        throw new ApiError(
          "invalid_input",
          "El nombre debe tener al menos 3 caracteres.",
          400
        )
      const secret = Array.from(
        crypto.getRandomValues(new Uint8Array(32)),
        (b) =>
          "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"[
            b % 64
          ]
      ).join("")
      const token = `${ADMIN_TOKEN_PREFIX}${secret}`
      const meta: AdminToken = {
        id: `tok_${hex(8)}`,
        name: body.name,
        prefix: token.slice(0, 12),
        scopes: body.scopes ?? ["admin:read"],
        createdBy: "dev@sideband.local",
        createdAt: new Date().toISOString(),
        expiresAt: new Date(
          Date.now() + (body.ttlDays ?? 7) * 86_400_000
        ).toISOString(),
        lastUsedAt: null,
        revokedAt: null,
      }
      tokens.unshift(meta)
      return { token, meta }
    }
    case "revokeToken": {
      operatorOnly()
      const token = tokens.find((t) => t.id === params.id)
      if (!token) throw new ApiError("not_found", "Token no encontrado.", 404)
      token.revokedAt = new Date().toISOString()
      return { ok: true }
    }
  }
}
