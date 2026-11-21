import { redirect } from "next/navigation";

import { getAddress } from "../owner";
import { card } from "../ui";
import { AddressForm } from "./form";

export default async function OnboardingPage() {
  if (await getAddress()) redirect("/");

  return (
    <section className={`${card} mx-auto max-w-lg p-6 sm:p-9`}>
      <h1 className="text-3xl font-semibold tracking-tight">Elige tu dirección Nexo</h1>
      <p className="mt-3 text-[#525e50]">Compártela para recibir solicitudes de los agentes de otras personas.</p>
      <AddressForm />
    </section>
  );
}
