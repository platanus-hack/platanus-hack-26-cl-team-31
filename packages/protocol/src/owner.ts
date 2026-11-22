import { z } from "zod";
import { Address } from "./address.js";
import { FinalOutcome, RequestStatus, SenderMessage, withToolArgs } from "./request.js";
import { Sharing, Tag, TagId, TagIds } from "./sharing.js";
import { ToolName, ToolResult } from "./tools.js";
import { WakeKind } from "./wake.js";

const datetime = z.iso.datetime({ offset: true });

export const ConnectInput = z.object({ to: Address, share: Sharing.optional(), tags: TagIds.optional() });
export type ConnectInput = z.infer<typeof ConnectInput>;

export const OwnerDecision = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("approve_once") }),
  z.object({ kind: z.literal("grant_vault_read") }),
  z.object({ kind: z.literal("grant_category") }),
  z.object({ kind: z.literal("deny") }),
  z.object({ kind: z.literal("answer"), result: ToolResult }),
]);
export type OwnerDecision = z.infer<typeof OwnerDecision>;

export const AgentConnection = z.object({
  agentId: z.string(),
  label: z.string(),
  wakeKind: WakeKind,
  verifiedAt: datetime.optional(),
  lastWakeAt: datetime.optional(),
  revokedAt: datetime.optional(),
  createdAt: datetime,
});
export type AgentConnection = z.infer<typeof AgentConnection>;

// Web resolves OAuth client names by agentId. Wake details stay in the personal connection list.
export const PublicAgent = AgentConnection.pick({ agentId: true, label: true }).extend({ address: Address });
export type PublicAgent = z.infer<typeof PublicAgent>;

export const OwnerPendingItem = withToolArgs({
  requestId: z.string(),
  from: Address,
  senderMessage: SenderMessage,
  escalated: z.boolean().optional(),
  expiresAt: datetime,
});
export type OwnerPendingItem = z.infer<typeof OwnerPendingItem>;

export const ActivityEvent = z.object({
  kind: z.enum(["received", "permission", "wake", "response", "delivery"]),
  at: datetime,
  status: RequestStatus.optional(),
});
export type ActivityEvent = z.infer<typeof ActivityEvent>;

const activityBase = z.object({
  requestId: z.string(),
  from: Address,
  to: Address,
  tool: ToolName,
  status: RequestStatus,
  outcome: FinalOutcome.optional(),
  createdAt: datetime,
  expiresAt: datetime,
  closedAt: datetime.optional(),
  events: z.array(ActivityEvent),
  droppedFields: z.array(z.string()).optional(),
});

export const ActivityItem = z.discriminatedUnion("direction", [
  activityBase.extend({ direction: z.literal("sent") }),
  activityBase.extend({
    direction: z.literal("received"),
    decisionReason: z.string().optional(),
    internalReason: z.string().max(300).optional(),
  }),
]);
export type ActivityItem = z.infer<typeof ActivityItem>;

export const Contact = z.object({
  address: Address,
  displayName: z.string().optional(),
  tags: z.array(TagId),
  gives: Sharing,
  receives: Sharing,
});
export type Contact = z.infer<typeof Contact>;

export const Invitation = z.object({
  requestId: z.string(),
  address: Address,
  offer: Sharing,
  expiresAt: datetime,
});
export type Invitation = z.infer<typeof Invitation>;

export const ContactsView = z.object({
  contacts: z.array(Contact),
  tags: z.array(Tag),
  incoming: z.array(Invitation),
  outgoing: z.array(Invitation),
});
export type ContactsView = z.infer<typeof ContactsView>;

export const PublicProfile = z.object({ address: Address, displayName: z.string(), headline: z.string().optional() });
export type PublicProfile = z.infer<typeof PublicProfile>;
export const ProfileSearch = z.object({ query: z.string().trim().min(2).max(100).refine(value => !value.includes("\0")) });

export const AgentContacts = z.object({
  contacts: z.array(z.object({ address: Address, displayName: z.string().optional(), tags: z.array(TagId), theyShare: Sharing, youShare: Sharing })),
  circles: z.array(z.object({
    id: z.string().optional(), name: z.string(), members: z.array(Address),
    memberNames: z.record(Address, z.string()).optional(),
  })),
});
export type AgentContacts = z.infer<typeof AgentContacts>;

export const InvitationAnswer = z.object({
  accept: z.boolean(),
  share: Sharing.optional(),
  tags: TagIds.optional(),
});
export type InvitationAnswer = z.infer<typeof InvitationAnswer>;
