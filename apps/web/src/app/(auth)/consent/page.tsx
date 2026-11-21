import { SCOPES } from "@team-31/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { getAuth, getSession } from "@/lib/auth";
import { getOwnerAddress } from "@/lib/auth-owner";
import { getOAuthRequest } from "@/lib/auth-request";

import { ConsentButtons } from "./consent-buttons";

const scopeDescriptions: Readonly<Record<string, string>> = {
  ...SCOPES,
  openid: "Identificar tu cuenta en Nexo",
  profile: "Ver tu nombre y foto de perfil",
  email: "Ver tu correo electrónico",
  offline_access: "Mantener la conexión cuando no estás en línea",
};

export default async function ConsentPage({ searchParams }: PageProps<"/consent">) {
  const request = await getOAuthRequest(await searchParams);
  if (!request) {
    return (
      <>
        <h1 className="text-2xl font-semibold">El enlace de autorización venció o no es válido</h1>
        <p className="mt-3 text-[#525a4c]">Vuelve a iniciar la conexión desde tu agente.</p>
      </>
    );
  }

  const session = await getSession();
  if (!session) redirect(`/sign-in?${request.signedQuery}`);

  const requestHeaders = await headers();
  const [client, address] = await Promise.all([
    getAuth().api.getOAuthClientPublic({
      headers: requestHeaders,
      query: { client_id: request.clientId },
    }),
    getOwnerAddress(session.user.id),
  ]);

  return (
    <>
      <h1 className="text-3xl font-semibold tracking-tight [overflow-wrap:anywhere]">
        Autorizar a {client.client_name?.trim() || "Agente sin nombre"}
      </h1>
      <p className="mt-3 text-[#525a4c] [overflow-wrap:anywhere]">
        {address ?? "Tu cuenta aún no tiene una dirección Nexo."}
      </p>
      <h2 className="mt-7 text-sm font-semibold">Permisos solicitados</h2>
      <ul className="mt-2 list-disc space-y-2 rounded-xl bg-[#eef1e8] py-4 pl-9 pr-4 text-sm text-[#323e2c]">
        {request.scopes.map((scope) => (
          <li key={scope}>{Object.hasOwn(scopeDescriptions, scope) ? scopeDescriptions[scope] : scope}</li>
        ))}
      </ul>
      <p className="mt-5 text-sm leading-relaxed text-[#525a4c]">
        Este agente va a poder responder solicitudes según las reglas que tú configuras en la App Nexo. Lo puedes desconectar cuando quieras.
      </p>
      <ConsentButtons />
    </>
  );
}
