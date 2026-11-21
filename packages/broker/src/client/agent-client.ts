import { Principal } from "@team-31/protocol";
import { routes } from "@team-31/protocol/http";
import type { AgentPort } from "../ports.js";
import { createHttpClient, type ClientOptions } from "./http.js";

export function createAgentClient(options: ClientOptions<Principal>): AgentPort {
  const request = createHttpClient(options, Principal);

  return {
    capabilities: (principal, to) => request(routes.agentCapabilities, principal, { query: { to } }),
    ask: (principal, body) => request(routes.agentAsk, principal, { body }),
    inbox: async (principal) => (await request(routes.agentInbox, principal)).items,
    reply: (principal, body) => request(routes.agentReply, principal, { body }),
    status: (principal, id) => request(routes.agentStatus, principal, { params: { id } }),
    connectWake: (principal, body) => request(routes.agentConnectWake, principal, { body }),
    disconnectWake: (principal, subscriptionId) =>
      request(routes.agentDisconnectWake, principal, { params: { subscriptionId } }),
  };
}
