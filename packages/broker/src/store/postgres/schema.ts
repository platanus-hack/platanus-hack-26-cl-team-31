import { RequestStatus } from "@team-31/protocol";
import { sql } from "drizzle-orm";
import {
  bigserial, boolean, check, customType, index, integer, jsonb, pgSchema,
  primaryKey, text, timestamp, uniqueIndex,
} from "drizzle-orm/pg-core";

export const sideband = pgSchema("sideband");
const time = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const bytea = customType<{ data: Buffer }>({ dataType: () => "bytea" });
const wakeStates = ["queued", "running", "done"] as const;

function values(options: readonly string[]) {
  return sql.join(options.map((option) => sql`${sql.raw("'" + option + "'")}`), sql`, `);
}

export const users = sideband.table("users", {
  userId: text("user_id").primaryKey(),
  address: text("address").unique(),
  displayName: text("display_name"),
  createdAt: time("created_at").notNull().defaultNow(),
});

// The broker stopped reading and writing this table when grants replaced sharing rules.
// It stays in the schema because ops.v_users still joins it.
export const sharingRules = sideband.table("sharing_rules", {
  userId: text("user_id").primaryKey().references(() => users.userId),
  rules: jsonb("rules").notNull(),
  updatedAt: time("updated_at").notNull().defaultNow(),
});

export const grants = sideband.table("grants", {
  id: text("id").primaryKey(),
  grantorUserId: text("grantor_user_id").notNull().references(() => users.userId),
  granteeAddress: text("grantee_address").notNull(),
  tool: text("tool").notNull(),
  fields: text("fields").array().notNull(),
  createdAt: time("created_at").notNull(),
  revokedAt: time("revoked_at"),
  friendDefault: boolean("friend_default").notNull().default(false),
}, (table) => [
  uniqueIndex("grants_live_idx").on(table.grantorUserId, table.granteeAddress, table.tool)
    .where(sql`${table.revokedAt} is null`),
]);

export const friends = sideband.table("friends", {
  userId: text("user_id").notNull().references(() => users.userId),
  address: text("address").notNull(),
}, (table) => [primaryKey({ columns: [table.userId, table.address] })]);

export const circles = sideband.table("circles", {
  id: text("id").primaryKey(),
  ownerUserId: text("owner_user_id").notNull().references(() => users.userId),
  name: text("name").notNull(),
  createdAt: time("created_at").notNull(),
});

export const circleMembers = sideband.table("circle_members", {
  circleId: text("circle_id").notNull().references(() => circles.id, { onDelete: "cascade" }),
  address: text("address").notNull(),
  // Null while the invitation is pending.
  joinedAt: time("joined_at"),
}, (table) => [
  primaryKey({ columns: [table.circleId, table.address] }),
  index("circle_members_address_idx").on(table.address),
]);

export const requests = sideband.table("requests", {
  id: text("id").primaryKey(),
  fromAddress: text("from_address").notNull(),
  toAddress: text("to_address").notNull(),
  fromUserId: text("from_user_id").references(() => users.userId),
  toUserId: text("to_user_id").references(() => users.userId),
  targetAgentId: text("target_agent_id"),
  tool: text("tool").notNull(),
  args: jsonb("args").notNull(),
  purpose: text("purpose"),
  status: text("status").notNull(),
  outcome: text("outcome"),
  allowedFields: text("allowed_fields").array().notNull(),
  approvedOnce: boolean("approved_once"),
  guidance: text("guidance").notNull(),
  rule: text("rule").notNull(),
  decisionReason: text("decision_reason"),
  internalReason: text("internal_reason"),
  result: jsonb("result"),
  droppedFields: text("dropped_fields").array(),
  answeredByAgentId: text("answered_by_agent_id"),
  escalated: boolean("escalated").notNull(),
  envelopeSignature: text("envelope_signature").notNull(),
  responseSignature: text("response_signature"),
  createdAt: time("created_at").notNull(),
  expiresAt: time("expires_at").notNull(),
  closedAt: time("closed_at"),
  version: integer("version").notNull(),
}, (table) => [
  check("requests_status_check", sql`${table.status} in (${values(RequestStatus.options)})`),
  index("requests_to_address_status_idx").on(table.toAddress, table.status),
  index("requests_from_user_created_at_idx").on(table.fromUserId, table.createdAt.desc()),
  index("requests_to_user_created_at_idx").on(table.toUserId, table.createdAt.desc()),
  index("requests_status_expires_at_idx").on(table.status, table.expiresAt),
]);

export const requestEvents = sideband.table("request_events", {
  id: bigserial("id", { mode: "bigint" }).primaryKey(),
  requestId: text("request_id").notNull().references(() => requests.id),
  at: time("at").notNull(),
  kind: text("kind").notNull(),
  detail: jsonb("detail").notNull(),
}, (table) => [
  index("request_events_request_id_id_idx").on(table.requestId, table.id),
]);

export const wakeJobs = sideband.table("wake_jobs", {
  id: text("id").primaryKey(),
  requestId: text("request_id").notNull().references(() => requests.id),
  requestVersion: integer("request_version").notNull(),
  attempt: integer("attempt").notNull(),
  runAt: time("run_at").notNull(),
  state: text("state", { enum: wakeStates }).notNull(),
  lastResult: jsonb("last_result"),
}, (table) => [
  check("wake_jobs_state_check", sql`${table.state} in (${values(wakeStates)})`),
  index("wake_jobs_state_run_at_idx").on(table.state, table.runAt, table.id),
]);

export const agentConnections = sideband.table("agent_connections", {
  userId: text("user_id").notNull().references(() => users.userId),
  agentId: text("agent_id").notNull(),
  label: text("label").notNull(),
  wakeKind: text("wake_kind").notNull(),
  wakePublic: jsonb("wake_public").notNull(),
  wakeSecret: bytea("wake_secret"),
  verifiedAt: time("verified_at"),
  lastWakeAt: time("last_wake_at"),
  revokedAt: time("revoked_at"),
  createdAt: time("created_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.userId, table.agentId] }),
  check("agent_connections_wake_secret_check", sql`(${table.wakeKind} = 'none') = (${table.wakeSecret} is null)`),
]);
