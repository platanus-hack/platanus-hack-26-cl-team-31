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
      <Heading title="Conectar con Sideband">
        {selected ? `Elige el tipo de bot para configurar ${selected.label}.` : "Conecta tu agente o usa Sideband desde WhatsApp."}
      </Heading>
      {agentId !== undefined && !selected && (
        <p role="status" className="mb-5 text-sm text-danger">No se encontró esa conexión. Puedes elegir otro bot.</p>
      )}
      <ul className="grid gap-4 md:grid-cols-3">
        <li>
          <Link href="/agents/connect/whatsapp" prefetch={false}
            className={`${card} group flex h-full flex-col gap-3 p-6 hover:bg-card-hover`}>
            <h2 className="text-[15px] font-medium tracking-[-0.01em]">WhatsApp</h2>
            <p className={secondaryText}>Vincula tu teléfono y usa tu cuenta de Sideband desde el chat.</p>
            <span className="mt-auto pt-1 text-sm font-medium text-accent-ink group-hover:underline">Conectar WhatsApp <span aria-hidden="true">→</span></span>
          </Link>
        </li>
        {choices.map((kind) => {
          const client = clients[kind];
          const linksToAgent = selected ? `?agentId=${encodeURIComponent(selected.agentId)}` : "";
          return (
            <li key={kind}>
              <Link href={`/agents/connect/${kind}${linksToAgent}`} prefetch={false}
                className={`${card} group flex h-full flex-col gap-3 p-6 hover:bg-card-hover`}>
                <h2 className="text-[15px] font-medium tracking-[-0.01em]">{client.name}</h2>
                <p className={secondaryText}>{client.description}</p>
                <span className="mt-auto pt-1 text-sm font-medium text-accent-ink group-hover:underline">Configurar {client.name} <span aria-hidden="true">→</span></span>
              </Link>
            </li>
          );
        })}
      </ul>
    </>
  );
}
