import Link from "next/link";

import { card, Heading, secondaryText, textLink } from "../../ui";
import { clients, type ClientKind } from "./clients";
import { listConnections } from "./connections";

export default async function ConnectPage({ searchParams }: PageProps<"/agents/connect">) {
  const { agentId } = await searchParams;
  const selected = (await listConnections()).find((connection) => connection.agentId === agentId);
  const choices = Object.keys(clients) as ClientKind[];

  return (
    <>
      <Link href="/agents" className={`${textLink} mb-5 inline-block text-sm`}>Volver a Agentes</Link>
      <Heading title="Conectar mi bot">
        {selected ? `Elige el tipo de bot para configurar ${selected.label}.` : "Elige el bot que quieres conectar a Nexo."}
      </Heading>
      {agentId !== undefined && !selected && (
        <p role="status" className="mb-5 text-sm text-[#792f26]">No se encontró esa conexión. Puedes elegir otro bot.</p>
      )}
      <ul className="grid gap-4 md:grid-cols-3">
        {choices.map((kind) => {
          const client = clients[kind];
          const linksToAgent = selected ? `?agentId=${encodeURIComponent(selected.agentId)}` : "";
          return (
            <li key={kind}>
              <Link href={`/agents/connect/${kind}${linksToAgent}`} prefetch={false}
                className={`${card} group flex h-full flex-col gap-3 p-6 transition hover:border-[#8aa78e]`}>
                <h2 className="text-lg font-semibold">{client.name}</h2>
                <p className={secondaryText}>{client.description}</p>
                <span className="mt-auto pt-1 text-sm font-semibold text-[#28513b] group-hover:underline">Configurar {client.name} <span aria-hidden="true">→</span></span>
              </Link>
            </li>
          );
        })}
      </ul>
    </>
  );
}
