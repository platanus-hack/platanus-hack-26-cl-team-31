import "server-only";

import type { Owner } from "@team-31/protocol";
import { redirect } from "next/navigation";
import { cache } from "react";

import { getOwnerAddress, getOwnerUser } from "@/lib/auth-owner";

export const getOwner = cache(async (): Promise<Owner> => {
  const user = await getOwnerUser();
  return { userId: user.id };
});

export const getAddress = cache(getOwnerAddress);

export async function requireAddress() {
  const address = await getAddress();
  if (!address) redirect("/onboarding");
  return address;
}

/**
 * Starts an owner-scoped read as soon as the session is known instead of after the address
 * lookup. The address check still decides the outcome: without an address it redirects to
 * onboarding and the read's result (or error) is discarded. Only for reads, never for changes.
 */
export async function readAsOwner<T>(read: (owner: Owner) => Promise<T>) {
  const owner = await getOwner();
  const data = read(owner);
  // Awaited below once the address check passes; until then a failure must not go unhandled.
  data.catch(() => undefined);
  const address = await requireAddress();
  return { address, owner, data: await data };
}
