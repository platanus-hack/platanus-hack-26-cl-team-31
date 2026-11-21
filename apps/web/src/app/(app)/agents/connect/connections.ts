import "server-only";

import { ownerClient } from "@/lib/broker";

import { getOwner, requireAddress } from "../../owner";

export async function connectContext() {
  await requireAddress();
  return { owner: await getOwner(), broker: ownerClient() };
}

export async function listConnections() {
  const { owner, broker } = await connectContext();
  return (await broker.agents(owner)).filter((agent) => !agent.revokedAt);
}
