import { redirect } from "next/navigation";

import { onboardingFlow } from "@/lib/onboarding-flow";

import { getAddress } from "../owner";
import { card } from "../ui";
import { AddressForm } from "./form";

export default async function OnboardingPage({ searchParams }: PageProps<"/onboarding">) {
  const flow = onboardingFlow((await searchParams).from);
  if (await getAddress()) redirect(flow.destination);

  return (
    <section className={`${card} mx-auto max-w-lg p-6 sm:p-9`}>
      <h1 className="text-[28px] leading-[1.15] font-medium tracking-[-0.025em]">Elige tu dirección Nexo</h1>
      <p className="mt-3 text-muted">Compártela para recibir solicitudes de los agentes de otras personas.</p>
      <AddressForm source={flow.source} />
    </section>
  );
}
