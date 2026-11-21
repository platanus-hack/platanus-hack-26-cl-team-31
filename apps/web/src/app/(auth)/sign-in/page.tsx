import { redirect } from "next/navigation";

import { getSession } from "@/lib/auth";
import { getGoogleOptions } from "@/lib/auth-env.mjs";
import { getOAuthRequest } from "@/lib/auth-request";
import { onboardingFlow } from "@/lib/onboarding-flow";

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
        <h1 className="text-2xl font-semibold">El enlace de autorización venció o no es válido</h1>
        <p className="mt-3 text-[#525a4c]">Vuelve a iniciar la conexión desde tu agente.</p>
      </>
    );
  }

  const flow = onboardingFlow(request ? undefined : params.from);
  if (!request && await getSession()) redirect(flow.signInComplete);

  return (
    <>
      <h1 className="text-3xl font-semibold tracking-tight">Entrar a Nexo</h1>
      <p className="mt-3 text-[#525a4c]">
        {request
          ? "Inicia sesión con tu cuenta de Google para revisar los permisos del agente."
          : "Conecta tus agentes y decide qué pueden compartir en tu nombre."}
      </p>
      {params.error && (
        <p role="alert" className="mt-4 text-sm text-red-800">
          No se pudo completar el inicio de sesión. Intenta de nuevo.
        </p>
      )}
      {getGoogleOptions() ? (
        <GoogleButton
          callbackURL={flow.signInComplete}
          errorCallbackURL={request ? `/sign-in?${request.signedQuery}` : flow.signIn}
        />
      ) : (
        <p className="mt-4 text-sm text-[#525a4c]" role="status">
          Configura las credenciales de Google en el entorno local para iniciar sesión.
        </p>
      )}
    </>
  );
}
