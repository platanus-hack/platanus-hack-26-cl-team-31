import { AdminActor } from "@team-31/protocol";
import { routes } from "@team-31/protocol/http";
import type { AdminPort } from "./ports.js";
import { createHttpClient, type ClientOptions } from "./http.js";

export function createAdminClient(options: ClientOptions<AdminActor>): AdminPort {
  const request = createHttpClient(options, AdminActor);
  return {
    rewake: (actor, id, reason) => request(routes.adminRewake, actor, { params: { id }, body: { reason } }),
    expire: (actor, id, reason) => request(routes.adminExpire, actor, { params: { id }, body: { reason } }),
    revokeAgent: (actor, userId, agentId, reason) =>
      request(routes.adminRevokeAgent, actor, { params: { userId, agentId }, body: { reason } }),
  };
}
