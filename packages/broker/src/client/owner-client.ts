import { Owner } from "@team-31/protocol";
import { encodeAsk, routes } from "@team-31/protocol/http";
import type { OwnerPort } from "../ports.js";
import { createHttpClient, type ClientOptions } from "./http.js";

export function createOwnerClient(options: ClientOptions<Owner>): OwnerPort {
  const request = createHttpClient(options, Owner);

  return {
    searchPublicProfiles: async (o, query) => (await request(routes.ownerSearchPublicProfiles, o, { body: { query } })).items,
    directory: o => request(routes.ownerDirectory, o),
    queryVault: (o, body) => request(routes.ownerQueryVault, o, { body }),
    vault: (o) => request(routes.ownerVault, o),
    changeVault: (o, body) => request(routes.ownerChangeVault, o, { body }),
    me: (owner) => request(routes.ownerMe, owner),
    claimAddress: async (owner, localPart) =>
      (await request(routes.ownerClaimAddress, owner, { body: { localPart } })).address,
    grants: async (owner) => (await request(routes.ownerGrants, owner)).items,
    setGrant: (owner, body) => request(routes.ownerSetGrant, owner, { body }),
    revokeGrant: (owner, id) => request(routes.ownerRevokeGrant, owner, { params: { id } }),
    pending: async (owner) => (await request(routes.ownerPending, owner)).items,
    activity: async (owner, limit) =>
      (await request(routes.ownerActivity, owner, { query: { limit } })).items,
    ask: (owner, body, channel) => channel
      ? request(routes.ownerChannelAsk, owner, { params: { name: channel }, body: encodeAsk(body) })
      : request(routes.ownerAsk, owner, { body: encodeAsk(body) }),
    status: (owner, id) => request(routes.ownerStatus, owner, { params: { id } }),
    decide: (owner, id, body) => request(routes.ownerDecide, owner, { params: { id }, body }),
    agentDirectory: async (owner) => (await request(routes.ownerAgentDirectory, owner)).items,
    agents: async (owner) => (await request(routes.ownerAgents, owner)).items,
    setWake: (owner, agentId, body) =>
      request(routes.ownerSetWake, owner, { params: { agentId }, body }),
    setChannel: (owner, name, body) => request(routes.ownerSetChannel, owner, { params: { name }, body }),
    ping: (owner, agentId) => request(routes.ownerPing, owner, { params: { agentId } }),
    revokeAgent: (owner, agentId) => request(routes.ownerRevokeAgent, owner, { params: { agentId } }),
    connect: (owner, to, share, tag) => request(routes.ownerConnect, owner, { body: { to, share, tag } }),
    contacts: (owner) => request(routes.ownerContacts, owner),
    setSharing: (owner, address, body) => request(routes.ownerSetSharing, owner, { params: { address }, body }),
    setContactTag: (owner, address, tag) => request(routes.ownerSetContactTag, owner, { params: { address }, body: { tag } }),
    setTagPreset: (owner, tag, body) => request(routes.ownerSetTagPreset, owner, { params: { tag }, body }),
    answerInvitation: (owner, id, body) => request(routes.ownerAnswerInvitation, owner, { params: { id }, body }),
    circles: async (owner) => (await request(routes.ownerCircles, owner)).items,
    createCircle: (owner, name) => request(routes.ownerCreateCircle, owner, { body: { name } }),
    deleteCircle: (owner, id) => request(routes.ownerDeleteCircle, owner, { params: { id } }),
    inviteToCircle: (owner, id, address) => request(routes.ownerInviteToCircle, owner, { params: { id, address } }),
    joinCircle: (owner, id) => request(routes.ownerJoinCircle, owner, { params: { id } }),
    removeFromCircle: (owner, id, address) => request(routes.ownerRemoveFromCircle, owner, { params: { id, address } }),
    removeFriend: (owner, address) => request(routes.ownerRemoveFriend, owner, { params: { address } }),
  };
}
