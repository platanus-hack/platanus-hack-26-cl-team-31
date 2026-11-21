import { SCOPES } from "@team-31/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { getAuth, getSession } from "@/lib/auth";
import { getOwnerAddress } from "@/lib/auth-owner";
import { InvalidAuthorizationLink } from "../invalid-authorization-link";
import { getOAuthRequest } from "@/lib/auth-request";

import { ConsentButtons } from "./consent-buttons";

const scopeDescriptions: Readonly<Record<string, string>> = {
  ...SCOPES,
  openid: "Identificar tu cuenta en Sideband",
  profile: "Ver tu nombre y foto de perfil",
  email: "Ver tu correo electrónico",
  offline_access: "Mantener la conexión cuando no estás en línea",
};

export default async function ConsentPage({ searchParams }: PageProps<"/consent">) {
  const request = await getOAuthRequest(await searchParams);
  if (!request) return <InvalidAuthorizationLink />;

  const session = await getSession();
  if (!session) redirect(`/sign-in?${request.signedQuery}`);

  const requestHeaders = await headers();
  const [client, address] = await Promise.all([
    getAuth().api.getOAuthClientPublic({
      headers: requestHeaders,
      query: { client_id: request.clientId },
    }),
    getOwnerAddress(),
  ]);

  return (
    <>
      <h1 className="text-[28px] leading-[1.15] font-medium tracking-[-0.025em] [overflow-wrap:anywhere]">
        Autorizar a {client.client_name?.trim() || "Agente sin nombre"}
      </h1>
      <p className="mt-3 text-muted [overflow-wrap:anywhere]">
        {address ?? "Tu cuenta aún no tiene una dirección Sideband."}
      </p>
      <h2 className="mt-7 text-sm font-medium">Permisos solicitados</h2>
      <ul className="mt-2 list-disc space-y-2 rounded-xl stage py-4 pl-9 pr-4 text-sm text-ink">
        {request.scopes.map((scope) => (
          <li key={scope}>{Object.hasOwn(scopeDescriptions, scope) ? scopeDescriptions[scope] : scope}</li>
        ))}
      </ul>
      <p className="mt-5 text-sm leading-relaxed text-muted">
        Este agente va a poder responder solicitudes según las reglas que tú configuras en la App Sideband. Lo puedes desconectar cuando quieras.
      </p>
      <ConsentButtons />
    </>
  );
}
