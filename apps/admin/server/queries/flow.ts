import type { RequestStatus } from "@team-31/protocol"

import { FlowRequestRef, FlowSnapshot } from "../../shared/contract.js"
import { iso, isoOrNull, viewExists, type Db } from "./db.js"

// Foto del flujo en vivo (página Flujo): límites por lista y ventana de solicitudes recientes.
const FLOW_USERS = 1000
const FLOW_AGENTS = 2000
const FLOW_REQUESTS = 300
const FLOW_REFS = 200
const FLOW_REQUEST_COLUMNS = "id, from_address, to_address, target_agent_id, answered_by_agent_id, status, created_at"

function toFlowRequestRef(row: Record<string, unknown>): FlowRequestRef {
  return FlowRequestRef.parse({
    id: row.id,
    fromAddress: row.from_address,
    toAddress: row.to_address,
    targetAgentId: row.target_agent_id ?? null,
    answeredByAgentId: row.answered_by_agent_id ?? null,
    status: row.status,
    createdAt: iso(row.created_at as Date | string),
  })
}

export async function latestEventId(db: Db): Promise<string | null> {
  const { rows } = await db.query<{ id: string | null }>(
    "SELECT max(id)::text AS id FROM ops.v_events"
  )
  return rows[0]?.id ?? null
}

export async function flowSnapshot(db: Db, openStatuses: readonly RequestStatus[]): Promise<FlowSnapshot> {
  // El cursor va primero: lo que se escriba al leer las listas llega por el stream.
  const cursor = await latestEventId(db)
  const users = await db.query(
    `SELECT user_id, address, display_name FROM ops.v_users
     ORDER BY address IS NULL, created_at DESC, user_id LIMIT ${FLOW_USERS + 1}`
  )
  const hasClients = await viewExists(db, "ops.v_oauth_clients")
  const agents = await db.query(
    `SELECT a.user_id, a.agent_id, ${hasClients ? "coalesce(nullif(c.name, ''), a.label)" : "a.label"} AS label,
       a.wake_kind, a.verified_at, a.revoked_at, a.created_at
     FROM ops.v_agent_connections a
     ${hasClients ? "LEFT JOIN ops.v_oauth_clients c ON c.client_id = a.agent_id" : ""}
     WHERE revoked_at IS NULL OR revoked_at > now() - interval '24 hours'
     ORDER BY a.created_at DESC, a.user_id, a.agent_id LIMIT ${FLOW_AGENTS + 1}`
  )
  const requests = await db.query(
    `SELECT ${FLOW_REQUEST_COLUMNS} FROM ops.v_requests
     WHERE status = ANY($1::text[]) OR created_at > now() - interval '15 minutes'
       OR closed_at > now() - interval '15 minutes'
     ORDER BY created_at DESC, id LIMIT ${FLOW_REQUESTS + 1}`,
    [openStatuses]
  )
  const { rows: [clock] } = await db.query<{ now: Date }>("SELECT now() AS now")
  return FlowSnapshot.parse({
    generatedAt: iso(clock!.now),
    cursor,
    users: users.rows.slice(0, FLOW_USERS).map((row) => ({
      userId: row.user_id,
      address: row.address ?? null,
      displayName: row.display_name ?? null,
    })),
    agents: agents.rows.slice(0, FLOW_AGENTS).map((row) => ({
      userId: row.user_id,
      agentId: row.agent_id,
      label: row.label,
      wakeKind: row.wake_kind,
      verifiedAt: isoOrNull(row.verified_at),
      revokedAt: isoOrNull(row.revoked_at),
      createdAt: iso(row.created_at),
    })),
    requests: requests.rows.slice(0, FLOW_REQUESTS).map(toFlowRequestRef),
    truncated:
      users.rows.length > FLOW_USERS ||
      agents.rows.length > FLOW_AGENTS ||
      requests.rows.length > FLOW_REQUESTS,
  })
}

export async function requestRefs(db: Db, ids: readonly string[]): Promise<FlowRequestRef[]> {
  const wanted = [...new Set(ids)].slice(0, FLOW_REFS)
  if (wanted.length === 0) return []
  const { rows } = await db.query(
    `SELECT ${FLOW_REQUEST_COLUMNS} FROM ops.v_requests WHERE id = ANY($1::text[])`,
    [wanted]
  )
  return rows.map(toFlowRequestRef)
}
