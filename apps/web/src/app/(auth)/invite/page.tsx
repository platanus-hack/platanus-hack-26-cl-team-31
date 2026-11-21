import Link from "next/link";

import { onboardingFlow } from "@/lib/onboarding-flow";
import { observeWebRequest, getTelemetry } from "@/lib/telemetry";

import { primaryButton } from "../../(app)/ui";

export default async function InvitePage() {
  await observeWebRequest("GET", "/invite", () => {
    getTelemetry().emit("web.invite.progress", { attrs: { step: "opened" } });
  });
  return (
    <>
      <h1 className="text-3xl font-semibold tracking-tight">Te invitaron a Nexo</h1>
      <p className="mt-3 text-[#525a4c]">
        Crea tu dirección Nexo y conecta tu agente para recibir solicitudes. Tú decides qué puede compartir en tu nombre.
      </p>
      <Link href={onboardingFlow("invite").signIn} prefetch={false} className={`${primaryButton} mt-7 w-full`}>
        Continuar
      </Link>
    </>
  );
}
