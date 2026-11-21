import { redirect } from "next/navigation";

import { getSession } from "@/lib/auth";
import { getGoogleOptions } from "@/lib/auth-env.mjs";
import { getOAuthRequest } from "@/lib/auth-request";
import { onboardingFlow } from "@/lib/onboarding-flow";
import { observeWebRequest, getTelemetry } from "@/lib/telemetry";

import { GoogleButton } from "./google-button";

export const instant = false;

export default async function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  const params = await searchParams;
  const isOAuth = "client_id" in params || "sig" in params;
  const oauthParams = { ...params };
  delete oauthParams.error;
  delete oauthParams.error_description;
  const request = isOAuth ? await getOAuthRequest(oauthParams) : null;

  if (isOAuth && !request) {
    return (
      <>
        <h1 className="text-[22px] leading-tight font-medium tracking-[-0.02em]">El enlace de autorización venció o no es válido</h1>
        <p className="mt-3 text-muted">Vuelve a iniciar la conexión desde tu agente.</p>
      </>
    );
  }

  const flow = onboardingFlow(request ? undefined : params.from);
  const session = !request && (flow.source === "invite"
    ? await observeWebRequest("GET", "/sign-in", async (span) => {
        const session = await getSession();
        const telemetry = getTelemetry();
        if (session) telemetry.identify({ userId: session.user.id });
        telemetry.emit("web.invite.progress", { attrs: { step: "sign_in" } });
        if (params.error) {
          span.setErrorId(telemetry.error("web.invite.google_callback", new Error()));
        }
        return session;
      })
    : await getSession());
  if (session) redirect(flow.signInComplete);

  return (
    <>
      <h1 className="text-[28px] leading-[1.15] font-medium tracking-[-0.025em]">Entrar a Nexo</h1>
      <p className="mt-3 text-muted">
        {request
          ? "Inicia sesión con tu cuenta de Google para revisar los permisos del agente."
          : "Conecta tus agentes y decide qué pueden compartir en tu nombre."}
      </p>
      {params.error && (
        <p role="alert" className="mt-4 text-sm text-danger">
          No se pudo completar el inicio de sesión. Intenta de nuevo.
        </p>
      )}
      {getGoogleOptions() ? (
        <GoogleButton
          callbackURL={flow.signInComplete}
          errorCallbackURL={request ? `/sign-in?${request.signedQuery}` : flow.signIn}
        />
      ) : (
        <p className="mt-4 text-sm text-muted" role="status">
          Configura las credenciales de Google en el entorno local para iniciar sesión.
        </p>
      )}
    </>
  );
}
