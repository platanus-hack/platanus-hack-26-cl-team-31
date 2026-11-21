import { redirect } from "next/navigation";

import { getOwnerAddress } from "@/lib/auth-owner";
import { onboardingFlow } from "@/lib/onboarding-flow";

export default async function CompleteSignIn({ searchParams }: PageProps<"/sign-in/complete">) {
  const flow = onboardingFlow((await searchParams).from);
  redirect(await getOwnerAddress() ? flow.destination : flow.onboarding);
}
