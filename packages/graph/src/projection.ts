import { baseCost } from "./cost.js";
import { nodeId, topicId, type GraphMutation } from "./model.js";

/**
 * Proyección de las tablas actuales (`apps/server/sql/01-core.sql`) al grafo.
 * Solo lee columnas; no interpreta permisos. `can_ask`/`can_share` viajan como
 * `attrs` de la arista para que el hook de visibilidad pueda usarlos.
 */
export interface PersonRow {
  readonly id: string;
}
export interface MembershipRow {
  readonly person_id: string;
  readonly group_id: string;
  readonly can_ask: boolean;
  readonly can_share: boolean;
}
export interface InterestRow {
  readonly person_id: string;
  readonly interest: string;
  /** '' = público; si no, id de grupo. */
  readonly audience: string;
}

export interface CoreRows {
  readonly people: readonly PersonRow[];
  readonly memberships: readonly MembershipRow[];
  readonly interests: readonly InterestRow[];
}

export type ChangeOp = "upsert" | "delete";

export function personMutation(row: PersonRow, op: ChangeOp = "upsert"): GraphMutation {
  const id = nodeId("person", row.id);
  return op === "upsert" ? { op: "upsertNode", id } : { op: "removeNode", id };
}

export function membershipMutation(row: MembershipRow, op: ChangeOp = "upsert"): GraphMutation {
  const a = nodeId("person", row.person_id);
  const b = nodeId("group", row.group_id);
  if (op === "delete") return { op: "removeEdge", a, b, kind: "member_of" };
  return {
    op: "upsertEdge",
    a,
    b,
    kind: "member_of",
    base: baseCost("member_of"),
    attrs: { canAsk: row.can_ask, canShare: row.can_share },
  };
}

export function interestMutation(row: InterestRow, op: ChangeOp = "upsert"): GraphMutation {
  const a = nodeId("person", row.person_id);
  const b = topicId(row.interest);
  const scope = row.audience;
  if (op === "delete") return { op: "removeEdge", a, b, kind: "interested_in", scope };
  return { op: "upsertEdge", a, b, kind: "interested_in", scope, base: baseCost("interested_in", scope) };
}

export function* projectCore(rows: CoreRows): Generator<GraphMutation> {
  for (const p of rows.people) yield personMutation(p);
  for (const m of rows.memberships) yield membershipMutation(m);
  for (const i of rows.interests) yield interestMutation(i);
}
