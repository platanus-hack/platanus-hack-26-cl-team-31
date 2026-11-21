import { Principal } from "@team-31/protocol";
import { encodeAsk, routes } from "@team-31/protocol/http";
import type { AgentPort } from "../ports.js";
import { createHttpClient, type ClientOptions } from "./http.js";

export function createAgentClient(options: ClientOptions<Principal>): AgentPort {
  const request = createHttpClient(options, Principal);

  return {
    searchPublicProfiles: async (p, query) => (await request(routes.agentSearchPublicProfiles, p, { body: { query } })).items,
    connect: (p) => request(routes.agentConnect, p),
    vaultCatalog: (p) => request(routes.agentVaultCatalog, p),
    contactGroups: (p) => request(routes.agentContactGroups, p),
    changeContactGroup: (p, body) => request(routes.agentChangeContactGroup, p, { body }),
    changeVault: (p, body) => request(routes.agentChangeVault, p, { body }),
    queryVault: (p, body) => request(routes.agentQueryVault, p, { body }),
    capabilities: (principal, to) => request(routes.agentCapabilities, principal, { query: { to } }),
    ask: (principal, body) => request(routes.agentAsk, principal, { body: encodeAsk(body) }),
    inbox: async (principal, includeInvitations) => (await request(routes.agentInbox, principal, {
      query: { includeInvitations: includeInvitations ? "true" : undefined },
    })).items,
    reply: (principal, body) => request(routes.agentReply, principal, { body }),
    contacts: (principal) => request(routes.agentContacts, principal),
    status: (principal, id) => request(routes.agentStatus, principal, { params: { id } }),
    connectWake: (principal, body) => request(routes.agentConnectWake, principal, { body }),
    disconnectWake: (principal, subscriptionId) =>
      request(routes.agentDisconnectWake, principal, { params: { subscriptionId } }),
  };
}
