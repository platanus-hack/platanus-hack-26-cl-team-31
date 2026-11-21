import "server-only";

import { ownerClient } from "@/lib/broker";

import { getOwner, readAsOwner, requireAddress } from "../../owner";

export async function connectContext() {
  await requireAddress();
  return { owner: await getOwner(), broker: ownerClient() };
}

export async function listConnections() {
  const { data: agents } = await readAsOwner((owner) => ownerClient().agents(owner));
  return agents.filter((agent) => !agent.revokedAt);
}
