import { redirect } from "next/navigation";

import { requireSession } from "@/lib/auth";
import { getOwnerAddress } from "@/lib/auth-owner";

export default async function CompleteSignIn() {
  const { user } = await requireSession();
  redirect(await getOwnerAddress(user.id) ? "/" : "/onboarding");
}
