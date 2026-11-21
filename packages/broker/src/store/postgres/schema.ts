import { ChannelName, RequestStatus } from "@team-31/protocol";
import { sql } from "drizzle-orm";
import {
  bigserial, boolean, check, customType, index, integer, jsonb, pgSchema,
  primaryKey, text, timestamp, uniqueIndex, foreignKey,
} from "drizzle-orm/pg-core";

export const sideband = pgSchema("sideband");
const time = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const bytea = customType<{ data: Buffer }>({ dataType: () => "bytea" });
const wakeStates = ["queued", "running", "done"] as const;
const wakeAudiences = ["recipient", "origin"] as const;
const channelNames = ChannelName.options as [ChannelName, ...ChannelName[]];

function values(options: readonly string[]) {
  return sql.join(options.map((option) => sql`${sql.raw("'" + option + "'")}`), sql`, `);
}

export const users = sideband.table("users", {
  userId: text("user_id").primaryKey(),
  address: text("address").unique(),
  displayName: text("display_name"),
  createdAt: time("created_at").notNull().defaultNow(),
  tagsSeeded: boolean("tags_seeded").notNull().default(false),
  vaultSeeded: boolean("vault_seeded").notNull().default(false),
});

export const tags = sideband.table("tags", {
  userId: text("user_id").notNull().references(() => users.userId),
  id: text("tag_id").notNull(),
  name: text("name").notNull(),
  color: text("color").notNull(),
  categories: jsonb("categories").notNull(),
}, (t) => [primaryKey({ columns: [t.userId, t.id] }), uniqueIndex("tags_name_idx").on(t.userId, sql`lower(${t.name})`)]);

export const quotaWindows = sideband.table("quota_windows", {
  userId: text("user_id").notNull(), bucket: text("bucket").notNull(),
  count: integer("count").notNull(), resetAt: time("reset_at").notNull(),
}, (t) => [primaryKey({ columns: [t.userId, t.bucket] }), index("quota_expiry_idx").on(t.resetAt)]);

export const vaultCategories = sideband.table("vault_categories", {
  owner: text("owner_id").notNull().references(() => users.userId),
  id: text("category_id").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
}, (t) => [primaryKey({ columns: [t.owner, t.id] })]);

export const vaultEntries = sideband.table("vault_entries", {
  owner: text("owner_id").notNull(), id: text("category_id").notNull(),
  label: text("label").notNull(), value: jsonb("value").$type<string | number | boolean>().notNull(),
}, (t) => [primaryKey({ columns: [t.owner, t.id, t.label] }),
  foreignKey({ columns: [t.owner, t.id], foreignColumns: [vaultCategories.owner, vaultCategories.id] }).onDelete("cascade")]);

export const vaultPermissions = sideband.table("vault_permissions", {
  owner: text("owner_id").notNull(), id: text("category_id").notNull(), tagId: text("tag_id").notNull(),
}, (t) => [primaryKey({ columns: [t.owner, t.id, t.tagId] }),
  foreignKey({ columns: [t.owner, t.id], foreignColumns: [vaultCategories.owner, vaultCategories.id] }).onDelete("cascade"),
  foreignKey({ columns: [t.owner, t.tagId], foreignColumns: [tags.userId, tags.id] }).onDelete("cascade")]);

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
  category: text("category").notNull(),
  createdAt: time("created_at").notNull(),
  revokedAt: time("revoked_at"),
}, (table) => [
  uniqueIndex("grants_live_idx").on(table.grantorUserId, table.granteeAddress, table.category)
    .where(sql`${table.revokedAt} is null`),
]);

export const vaultDocuments = sideband.table("vault_documents", {
  id: text("document_id").primaryKey(),
  owner: text("owner_id").notNull(),
  categoryId: text("category_id").notNull(),
  fileName: text("file_name").notNull(),
  mimeType: text("mime_type"),
  sizeBytes: integer("size_bytes").notNull(),
  sha256: text("sha256").notNull(),
  content: bytea("content").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  createdAt: time("created_at").notNull(),
}, (t) => [
  uniqueIndex("vault_documents_owner_idempotency_idx").on(t.owner, t.idempotencyKey),
  foreignKey({ name: "vault_documents_category_fk", columns: [t.owner, t.categoryId], foreignColumns: [vaultCategories.owner, vaultCategories.id] }).onDelete("cascade"),
  check("vault_documents_size_check", sql`${t.sizeBytes} >= 0 AND ${t.sizeBytes} <= 5242880`),
]);

export const friends = sideband.table("friends", {
  userId: text("user_id").notNull().references(() => users.userId),
  address: text("address").notNull(),
}, (table) => [primaryKey({ columns: [table.userId, table.address] })]);

export const vaultMemberRules = sideband.table("vault_member_rules", {
  owner: text("owner_id").notNull(), id: text("category_id").notNull(),
  address: text("address").notNull(), allowed: boolean("allowed").notNull(),
}, t => [primaryKey({ columns: [t.owner, t.id, t.address] }),
  foreignKey({ columns: [t.owner, t.id], foreignColumns: [vaultCategories.owner, vaultCategories.id] }).onDelete("cascade"),
  foreignKey({ columns: [t.owner, t.address], foreignColumns: [friends.userId, friends.address] }).onDelete("cascade")]);

export const contactTags = sideband.table("contact_tags", {
  userId: text("user_id").notNull().references(() => users.userId),
  address: text("address").notNull(),
  tagId: text("tag_id").notNull(),
}, (t) => [primaryKey({ columns: [t.userId, t.address, t.tagId] }),
  foreignKey({ columns: [t.userId, t.tagId], foreignColumns: [tags.userId, tags.id] }).onDelete("cascade")]);

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
  originChannel: text("origin_channel", { enum: channelNames }),
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
  check("requests_origin_channel_check", sql`${table.originChannel} in (${values(channelNames)})`),
  index("requests_to_address_status_idx").on(table.toAddress, table.status),
  index("requests_from_user_created_at_idx").on(table.fromUserId, table.createdAt.desc()),
  index("requests_to_user_created_at_idx").on(table.toUserId, table.createdAt.desc()),
  index("requests_status_expires_at_idx").on(table.status, table.expiresAt),
]);

export const askReceipts = sideband.table("ask_receipts", {
  keyHash: text("key_hash").primaryKey(),
  inputHash: text("input_hash").notNull(),
  requestId: text("request_id").notNull().references(() => requests.id, { onDelete: "cascade" }),
  waitingFor: text("waiting_for", { enum: ["agent", "owner"] }),
}, (t) => [index("ask_receipts_request_idx").on(t.requestId)]);

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
  audience: text("audience", { enum: wakeAudiences }).notNull().default("recipient"),
  attempt: integer("attempt").notNull(),
  runAt: time("run_at").notNull(),
  state: text("state", { enum: wakeStates }).notNull(),
  lastResult: jsonb("last_result"),
}, (table) => [
  check("wake_jobs_state_check", sql`${table.state} in (${values(wakeStates)})`),
  check("wake_jobs_audience_check", sql`${table.audience} in (${values(wakeAudiences)})`),
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
  uniqueIndex("agent_connections_one_active").on(table.userId).where(sql`${table.revokedAt} is null`),
  check("agent_connections_wake_secret_check", sql`(${table.wakeKind} = 'none') = (${table.wakeSecret} is null)`),
]);

export const channels = sideband.table("channels", {
  userId: text("user_id").notNull().references(() => users.userId),
  name: text("name", { enum: channelNames }).notNull(),
  wakeKind: text("wake_kind").notNull(),
  wakePublic: jsonb("wake_public").notNull(),
  wakeSecret: bytea("wake_secret"),
  createdAt: time("created_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.userId, table.name] }),
  check("channels_name_check", sql`${table.name} in (${values(channelNames)})`),
  check("channels_wake_secret_check", sql`(${table.wakeKind} = 'none') = (${table.wakeSecret} is null)`),
]);

// Conversation checkpoints are accessed only by the message-flow runtime.
export const messageTurns = sideband.table("message_turns", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  binding: text("binding").notNull(),
  agentId: text("agent_id").notNull(),
  deliveryId: text("delivery_id"),
  parentId: text("parent_id").unique(),
  state: jsonb("state"),
  outcome: text("outcome"),
  clarification: jsonb("clarification"),
  createdAt: time("created_at").notNull().defaultNow(),
  expiresAt: time("expires_at").notNull(),
}, t => [
  uniqueIndex("message_turn_delivery_idx").on(t.userId, t.binding, t.agentId, t.deliveryId),
  index("message_turn_binding_idx").on(t.userId, t.binding, t.agentId, t.createdAt),
  index("message_turn_expiry_idx").on(t.expiresAt),
]);
