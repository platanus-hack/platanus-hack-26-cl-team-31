import { z } from "zod";
import { Address, LocalPart } from "./address.js";
import { AdminActionInput } from "./admin.js";
import { Grant, GrantInput } from "./grants.js";
import { ActivityItem, AgentConnection, OwnerDecision, OwnerPendingItem } from "./owner.js";
import { Capability } from "./tools.js";
import { Owner } from "./principal.js";
import { AskInput, InboxItem, ReplyInput, ReplyReceipt, RequesterViewSchema } from "./request.js";
import { WakeTarget } from "./wake.js";

const requestParams = z.object({ id: z.string() });
const agentParams = z.object({ agentId: z.string() });
const adminAgentParams = z.object({ userId: z.string(), agentId: z.string() });
const noContent = { status: 204, response: z.undefined() } as const;

export const routes = {
  agentCapabilities: {
    method: "GET", path: "/v1/agent/capabilities", query: z.object({ to: Address }),
    response: z.object({ tools: z.array(Capability) }), iss: "mcp", port: "agent.capabilities",
  },
  agentAsk: {
    method: "POST",
    path: "/v1/agent/ask",
    body: AskInput,
    response: RequesterViewSchema,
    iss: "mcp",
    port: "agent.ask",
  },
  agentInbox: {
    method: "GET",
    path: "/v1/agent/inbox",
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
    query: z.object({ limit: z.coerce.number<string | number>().int().positive().optional() }),
    response: z.object({ items: z.array(ActivityItem) }),
    iss: "web",
    port: "owner.activity",
  },
  ownerAsk: {
    method: "POST", path: "/v1/owner/requests", body: AskInput,
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
