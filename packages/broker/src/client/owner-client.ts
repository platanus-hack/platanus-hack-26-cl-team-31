import { Owner } from "@team-31/protocol";
import { routes } from "@team-31/protocol/http";
import type { OwnerPort } from "../ports.js";
import { createHttpClient, type ClientOptions } from "./http.js";

export function createOwnerClient(options: ClientOptions<Owner>): OwnerPort {
  const request = createHttpClient(options, Owner);

  return {
    me: (owner) => request(routes.ownerMe, owner),
    claimAddress: async (owner, localPart) =>
      (await request(routes.ownerClaimAddress, owner, { body: { localPart } })).address,
    grants: async (owner) => (await request(routes.ownerGrants, owner)).items,
    setGrant: (owner, body) => request(routes.ownerSetGrant, owner, { body }),
    revokeGrant: (owner, id) => request(routes.ownerRevokeGrant, owner, { params: { id } }),
    pending: async (owner) => (await request(routes.ownerPending, owner)).items,
    activity: async (owner, limit) =>
      (await request(routes.ownerActivity, owner, { query: { limit } })).items,
    decide: (owner, id, body) => request(routes.ownerDecide, owner, { params: { id }, body }),
    agents: async (owner) => (await request(routes.ownerAgents, owner)).items,
    setWake: (owner, agentId, body) =>
      request(routes.ownerSetWake, owner, { params: { agentId }, body }),
    ping: (owner, agentId) => request(routes.ownerPing, owner, { params: { agentId } }),
    revokeAgent: (owner, agentId) => request(routes.ownerRevokeAgent, owner, { params: { agentId } }),
  };
}
