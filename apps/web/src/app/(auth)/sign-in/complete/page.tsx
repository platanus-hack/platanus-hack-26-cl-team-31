import { redirect } from "next/navigation";

import { getOwnerAddress } from "@/lib/auth-owner";

export default async function CompleteSignIn() {
  redirect(await getOwnerAddress() ? "/" : "/onboarding");
}
