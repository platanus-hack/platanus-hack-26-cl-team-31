export type OnboardingSource = "invite" | undefined;

export function onboardingFlow(source: unknown) {
  const fromInvite = source === "invite";
  const query = fromInvite ? "?from=invite" : "";

  return {
    source: fromInvite ? "invite" as const : undefined,
    signIn: `/sign-in${query}`,
    signInComplete: `/sign-in/complete${query}`,
    onboarding: `/onboarding${query}`,
    destination: fromInvite ? "/agents/connect" : "/",
  };
}
