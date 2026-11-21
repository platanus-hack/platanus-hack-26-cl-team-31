import { redirect } from "next/navigation";

import { getOwnerAddress } from "@/lib/auth-owner";
import { onboardingFlow } from "@/lib/onboarding-flow";
import { observeWebRequest, webTelemetry } from "@/lib/telemetry";

export default async function CompleteSignIn({ searchParams }: PageProps<"/sign-in/complete">) {
  const flow = onboardingFlow((await searchParams).from);
  const address = flow.source === "invite"
    ? await observeWebRequest("GET", "/sign-in/complete", async () => {
        const address = await getOwnerAddress();
        webTelemetry().emit("web.invite.progress", { attrs: { step: address ? "connect" : "claim_address" } });
        return address;
      })
    : await getOwnerAddress();
  redirect(address ? flow.destination : flow.onboarding);
}
