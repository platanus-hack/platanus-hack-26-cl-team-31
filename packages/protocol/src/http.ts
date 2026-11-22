import { z } from "zod";
import { Address, LocalPart } from "./address.js";
import { AdminActionInput } from "./admin.js";
import { Circle, CircleName } from "./circles.js";
import { Grant, GrantInput } from "./grants.js";
import { ActivityItem, AgentConnection, AgentContacts, ContactsView, ConnectInput, InvitationAnswer, OwnerDecision, OwnerPendingItem, PublicAgent, ProfileSearch, PublicProfile } from "./owner.js";
import { Sharing, Tag, TagId, TagIds, TagInput, TagUpdate } from "./sharing.js";
import { Capability } from "./tools.js";
import { Owner } from "./principal.js";
import { AskInput, type AskArguments, InboxItem, ReplyInput, ReplyReceipt, RequesterViewSchema } from "./request.js";
import { WakeTarget } from "./wake.js";
import {
  TagChange, TagReceipt, TagsView, OwnerVault, VaultCatalog, VaultCatalogQuery, VaultMembers, VaultMembersQuery, VaultQuery, VaultResult,
  VaultChange, VaultReceipt, VaultDocumentDownload, VaultDocumentQuery, VaultDocumentMetadata, VaultDocumentUpload,
} from "./vault.js";

// A pre-routing broker accepts an unwrapped AskInput and would strip unfamiliar optional
// fields. The envelope makes old replicas reject conditional sends before any side effect.
const AskBody = z.union([z.strictObject({ checked: AskInput }), AskInput]);
type AskBody = z.infer<typeof AskBody>;
export function encodeAsk(input: AskArguments): z.input<typeof AskBody> {
  return input.requireRelation || input.idempotencyKey ? { checked: input } : input;
}
export function decodeAsk(body: AskBody): AskInput {
  return "checked" in body ? body.checked : body;
}

const requestParams = z.object({ id: z.string() });
const agentParams = z.object({ agentId: z.string() });
const adminAgentParams = z.object({ userId: z.string(), agentId: z.string() });
const noContent = { status: 204, response: z.undefined() } as const;
const circleMemberParams = z.object({ id: z.string(), address: Address });

const activityQuery = z.object({
  limit: z.coerce.number<string | number>().int().positive().optional(),
  requestId: z.string().min(1).optional(),
});
export type ActivityQuery = z.output<typeof activityQuery>;

export const routes = {
  agentNetworkUsers: { method: "GET", path: "/v1/agent/network/users", query: z.strictObject({ after: Address.optional(), q: z.string().trim().min(1).max(128).toLowerCase().optional() }),
    response: z.object({ addresses: z.array(Address), nextCursor: Address.optional() }), iss: "mcp", port: "agent.networkUsers" },
  agentConnect: { method: "POST", path: "/v1/agent/connection", ...noContent, iss: "mcp", port: "agent.connect" },
  agentTags: { method: "GET", path: "/v1/agent/tags", response: TagsView, iss: "mcp", port: "agent.tags" },
  agentChangeTag: { method: "POST", path: "/v1/agent/tags", body: TagChange, response: TagReceipt, iss: "mcp", port: "agent.changeTag" },
  ownerTags: { method: "GET", path: "/v1/owner/tags", response: TagsView, iss: "web", port: "owner.tags" },
  ownerCreateTag: { method: "POST", path: "/v1/owner/tags", body: TagInput, response: Tag, iss: "web", port: "owner.createTag" },
  ownerUpdateTag: {
    method: "PATCH", path: "/v1/owner/tags/:id", params: z.object({ id: TagId }), body: TagUpdate, response: Tag, iss: "web", port: "owner.updateTag",
  },
  ownerDeleteTag: { method: "DELETE", path: "/v1/owner/tags/:id", params: z.object({ id: TagId }), ...noContent, iss: "web", port: "owner.deleteTag" },
  ownerVault: { method: "GET", path: "/v1/owner/vault", response: OwnerVault, iss: "web", port: "owner.vault" },
  ownerChangeVault: { method: "POST", path: "/v1/owner/vault", body: VaultChange, response: VaultReceipt, iss: "web", port: "owner.changeVault" },
  agentVaultCatalog: { method: "GET", path: "/v1/agent/vault", query: VaultCatalogQuery, response: VaultCatalog, iss: "mcp", port: "agent.vaultCatalog" },
  agentVaultMembers: { method: "GET", path: "/v1/agent/vault/members", query: VaultMembersQuery, response: VaultMembers, iss: "mcp", port: "agent.vaultMembers" },
  agentChangeVault: { method: "POST", path: "/v1/agent/vault", body: VaultChange, response: VaultReceipt, iss: "mcp", port: "agent.changeVault" },
  agentQueryVault: { method: "POST", path: "/v1/agent/vault/query", body: VaultQuery, response: VaultResult, iss: "mcp", port: "agent.queryVault" },
  agentVaultUpload: { method: "POST", path: "/v1/agent/vault/documents", body: VaultDocumentUpload, response: VaultDocumentMetadata, iss: "mcp", port: "agent.uploadVaultDocument" },
  agentVaultDownload: { method: "POST", path: "/v1/agent/vault/documents/download", body: VaultDocumentQuery, response: VaultDocumentDownload, iss: "mcp", port: "agent.downloadVaultDocument" },
  agentCapabilities: {
    method: "GET", path: "/v1/agent/capabilities", query: z.object({ to: Address }),
    response: z.object({ tools: z.array(Capability) }), iss: "mcp", port: "agent.capabilities",
  },
  agentAsk: {
    method: "POST",
    path: "/v1/agent/ask",
    body: AskBody,
    response: RequesterViewSchema,
    iss: "mcp",
    port: "agent.ask",
  },
  agentInbox: {
    method: "GET",
    path: "/v1/agent/inbox",
    query: z.object({ includeInvitations: z.literal("true").optional() }),
    response: z.object({ items: z.array(InboxItem) }),
    iss: "mcp",
    port: "agent.inbox",
  },
  agentReply: {
    method: "POST",
    path: "/v1/agent/reply",
    body: ReplyInput,
    response: ReplyReceipt,
    iss: "mcp",
    port: "agent.reply",
  },
  agentSearchPublicProfiles: { method: "POST", path: "/v1/agent/profiles/search", body: ProfileSearch, response: z.object({ items: z.array(PublicProfile) }), iss: "mcp", port: "agent.searchPublicProfiles" },
  ownerSearchPublicProfiles: { method: "POST", path: "/v1/owner/profiles/search", body: ProfileSearch, response: z.object({ items: z.array(PublicProfile) }), iss: "web", port: "owner.searchPublicProfiles" },
  ownerDirectory: { method: "GET", path: "/v1/owner/contact-directory", response: AgentContacts, iss: "web", port: "owner.directory" },
  ownerQueryVault: { method: "POST", path: "/v1/owner/vault/query", body: VaultQuery, response: VaultResult, iss: "web", port: "owner.queryVault" },
  agentContacts: {
    method: "GET",
    path: "/v1/agent/contacts",
    response: AgentContacts,
    iss: "mcp",
    port: "agent.contacts",
  },
  agentStatus: {
    method: "GET",
    path: "/v1/agent/requests/:id",
    params: requestParams,
    response: RequesterViewSchema,
    iss: "mcp",
    port: "agent.status",
  },
  agentConnectWake: {
    method: "POST",
    path: "/v1/agent/wake",
    body: WakeTarget,
    response: AgentConnection,
    iss: "mcp",
    port: "agent.connectWake",
  },
  agentDisconnectWake: {
    method: "DELETE",
    path: "/v1/agent/wake/:subscriptionId",
    params: z.object({ subscriptionId: z.string() }),
    ...noContent,
    iss: "mcp",
    port: "agent.disconnectWake",
  },
  ownerMe: {
    method: "GET",
    path: "/v1/owner/me",
    response: Owner.extend({ address: Address.optional(), displayName: z.string().optional() }),
    iss: "web",
    port: "owner.me",
  },
  ownerClaimAddress: {
    method: "POST",
    path: "/v1/owner/address",
    body: z.object({ localPart: LocalPart }),
    response: z.object({ address: Address }),
    iss: "web",
    port: "owner.claimAddress",
  },
  ownerGrants: {
    method: "GET",
    path: "/v1/owner/grants",
    response: z.object({ items: z.array(Grant) }),
    iss: "web",
    port: "owner.grants",
  },
  ownerSetGrant: {
    method: "PUT",
    path: "/v1/owner/grants",
    body: GrantInput,
    response: Grant,
    iss: "web",
    port: "owner.setGrant",
  },
  ownerRevokeGrant: {
    method: "DELETE",
    path: "/v1/owner/grants/:id",
    params: requestParams,
    ...noContent,
    iss: "web",
    port: "owner.revokeGrant",
  },
  ownerPending: {
    method: "GET",
    path: "/v1/owner/pending",
    response: z.object({ items: z.array(OwnerPendingItem) }),
    iss: "web",
    port: "owner.pending",
  },
  ownerActivity: {
    method: "GET",
    path: "/v1/owner/activity",
    query: activityQuery,
    response: z.object({ items: z.array(ActivityItem) }),
    iss: "web",
    port: "owner.activity",
  },
  agentActivity: {
    method: "GET",
    path: "/v1/agent/activity",
    query: activityQuery,
    response: z.object({ items: z.array(ActivityItem) }),
    iss: "mcp",
    port: "agent.activity",
  },
  ownerAsk: {
    method: "POST", path: "/v1/owner/requests", body: AskBody,
    response: RequesterViewSchema, iss: "web", port: "owner.ask",
  },
  ownerStatus: {
    method: "GET", path: "/v1/owner/requests/:id", params: requestParams,
    response: RequesterViewSchema, iss: "web", port: "owner.status",
  },
  ownerDecide: {
    method: "POST",
    path: "/v1/owner/requests/:id/decision",
    params: requestParams,
    body: OwnerDecision,
    ...noContent,
    iss: "web",
    port: "owner.decide",
  },
  ownerAgentDirectory: {
    method: "GET", path: "/v1/owner/agent-directory",
    response: z.object({ items: z.array(PublicAgent) }), iss: "web", port: "owner.agentDirectory",
  },
  ownerAgents: {
    method: "GET",
    path: "/v1/owner/agents",
    response: z.object({ items: z.array(AgentConnection) }),
    iss: "web",
    port: "owner.agents",
  },
  ownerSetWake: {
    method: "PUT",
    path: "/v1/owner/agents/:agentId/wake",
    params: agentParams,
    body: WakeTarget,
    ...noContent,
    iss: "web",
    port: "owner.setWake",
  },
  ownerPing: {
    method: "POST",
    path: "/v1/owner/agents/:agentId/ping",
    params: agentParams,
    response: z.object({ requestId: z.string() }),
    iss: "web",
    port: "owner.ping",
  },
  ownerRevokeAgent: {
    method: "DELETE",
    path: "/v1/owner/agents/:agentId",
    params: agentParams,
    ...noContent,
    iss: "web",
    port: "owner.revokeAgent",
  },
  ownerConnect: {
    method: "POST",
    path: "/v1/owner/connections",
    body: ConnectInput,
    response: RequesterViewSchema,
    iss: "web",
    port: "owner.connect",
  },
  ownerContacts: {
    method: "GET",
    path: "/v1/owner/connections",
    response: ContactsView,
    iss: "web",
    port: "owner.contacts",
  },
  ownerSetSharing: {
    method: "PUT",
    path: "/v1/owner/connections/:address/sharing",
    params: z.object({ address: Address }),
    body: Sharing,
    ...noContent,
    iss: "web",
    port: "owner.setSharing",
  },
  ownerSetContactTags: {
    method: "PUT",
    path: "/v1/owner/connections/:address/tags",
    params: z.object({ address: Address }),
    body: z.object({ tags: TagIds }),
    ...noContent,
    iss: "web",
    port: "owner.setContactTags",
  },
  ownerAnswerInvitation: {
    method: "POST",
    path: "/v1/owner/invitations/:id",
    params: requestParams,
    body: InvitationAnswer,
    ...noContent,
    iss: "web",
    port: "owner.answerInvitation",
  },
  ownerRemoveContact: {
    method: "DELETE",
    path: "/v1/owner/connections/:address",
    params: z.object({ address: Address }),
    ...noContent,
    iss: "web",
    port: "owner.removeContact",
  },
  ownerCircles: {
    method: "GET",
    path: "/v1/owner/circles",
    response: z.object({ items: z.array(Circle) }),
    iss: "web",
    port: "owner.circles",
  },
  ownerCreateCircle: {
    method: "POST",
    path: "/v1/owner/circles",
    body: z.object({ name: CircleName }),
    response: Circle,
    iss: "web",
    port: "owner.createCircle",
  },
  ownerDeleteCircle: {
    method: "DELETE",
    path: "/v1/owner/circles/:id",
    params: requestParams,
    ...noContent,
    iss: "web",
    port: "owner.deleteCircle",
  },
  ownerInviteToCircle: {
    method: "PUT",
    path: "/v1/owner/circles/:id/members/:address",
    params: circleMemberParams,
    ...noContent,
    iss: "web",
    port: "owner.inviteToCircle",
  },
  agentInviteToCircle: {
    method: "PUT",
    path: "/v1/agent/circles/:id/members/:address",
    params: circleMemberParams,
    ...noContent,
    iss: "mcp",
    port: "agent.inviteToCircle",
  },
  ownerJoinCircle: {
    method: "POST",
    path: "/v1/owner/circles/:id/join",
    params: requestParams,
    ...noContent,
    iss: "web",
    port: "owner.joinCircle",
  },
  ownerRemoveFromCircle: {
    method: "DELETE",
    path: "/v1/owner/circles/:id/members/:address",
    params: circleMemberParams,
    ...noContent,
    iss: "web",
    port: "owner.removeFromCircle",
  },
  ownerStream: {
    method: "GET",
    path: "/v1/owner/stream",
    contentType: "text/event-stream",
    response: ActivityItem,
    iss: "web",
    port: null,
  },
  adminRewake: {
    method: "POST",
    path: "/v1/admin/requests/:id/rewake",
    params: requestParams,
    body: AdminActionInput,
    ...noContent,
    iss: "admin",
    port: "admin.rewake",
  },
  adminExpire: {
    method: "POST",
    path: "/v1/admin/requests/:id/expire",
    params: requestParams,
    body: AdminActionInput,
    ...noContent,
    iss: "admin",
    port: "admin.expire",
  },
  adminRevokeAgent: {
    method: "POST",
    path: "/v1/admin/agents/:userId/:agentId/revoke",
    params: adminAgentParams,
    body: AdminActionInput,
    ...noContent,
    iss: "admin",
    port: "admin.revokeAgent",
  },
  health: {
    method: "GET",
    path: "/healthz",
    response: z.object({ ok: z.literal(true) }),
    iss: null,
    port: null,
  },
} as const;

export type RouteInput<Route> = {
  [Key in keyof Route & ("params" | "query" | "body")]: z.input<Route[Key]>;
};
