import "server-only";

import { redirect } from "next/navigation";
import { cache } from "react";

import { requireSession } from "@/lib/auth";
import { getOwnerAddress } from "@/lib/auth-owner";

export const getOwner = cache(async () => {
  const { user } = await requireSession();
  return { userId: user.id };
});

export const getAddress = cache(getOwnerAddress);

export async function requireAddress() {
  const address = await getAddress();
  if (!address) redirect("/onboarding");
  return address;
}
