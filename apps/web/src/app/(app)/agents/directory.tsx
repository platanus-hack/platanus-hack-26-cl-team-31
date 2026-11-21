import Link from "next/link";

import { getAuth } from "@/lib/auth";
import { ownerClient } from "@/lib/broker";

import { getOwner, requireAddress } from "../owner";
import { button, card, Empty, input, secondaryText, textLink } from "../ui";
import { CirclePicker } from "./circle-picker";

async function readAgentDirectory() {
  const address = await requireAddress();
  const owner = await getOwner();
  const broker = ownerClient();
  const [agents, circles] = await Promise.all([broker.agentDirectory(owner), broker.circles(owner)]);
  const clientIds = [...new Set(agents.filter((agent) => agent.agentId === agent.label).map((agent) => agent.agentId))];
  const { adapter } = await getAuth().$context;
  const clients = clientIds.length ? await adapter.findMany<{ clientId: string; name?: string }>({
    model: "oauthClient", select: ["clientId", "name"],
    where: [{ field: "clientId", operator: "in", value: clientIds }], limit: clientIds.length,
  }) : [];
  const names = new Map(clients.map((client) => [client.clientId, client.name?.trim()]));
  const profiles = agents.map(({ address, agentId, label }) => ({
    address, agentId, name: (label === agentId && names.get(agentId)) || label,
  })).sort((a, b) => a.name.localeCompare(b.name, "es") || a.address.localeCompare(b.address));
  return { agents: profiles, address, circles: circles.filter((circle) => circle.owner === address) };
}

export async function AgentDirectory({ query }: { query: string }) {
  const { agents, address, circles } = await readAgentDirectory();
  if (!agents.length) return <Empty>Aún no hay agentes inscritos en la red.</Empty>;

  const term = query.trim().toLocaleLowerCase("es");
  const profiles = agents.filter(({ name, address }) =>
    name.toLocaleLowerCase("es").includes(term) || address.includes(term));
  const memberships = circles.map((circle) => ({
    id: circle.id,
    name: circle.name,
    members: new Map(circle.members.map((member) => [member.address, member.joined])),
  }));

  return (
    <section aria-label="Directorio de agentes" className="max-w-3xl space-y-4">
      <form action="/agents" role="search" className="flex flex-wrap items-center gap-2">
        <input type="search" name="q" defaultValue={query} aria-label="Buscar por nombre o dirección"
          placeholder="Buscar por nombre o dirección" className={`${input} min-w-0 flex-1`} />
        <button className={button}>Buscar</button>
        {term && <Link href="/agents" className={textLink}>Limpiar</Link>}
      </form>
      {!circles.length && <p className={secondaryText}><Link href="/circles" className={textLink}>Crea un círculo</Link> para invitar a otros titulares.</p>}
      {!profiles.length ? <Empty>Ningún agente coincide con tu búsqueda.</Empty> : (
        <ul className={`${card} divide-y divide-line`}>
          {profiles.map((agent) => (
            <li key={`${agent.address}:${agent.agentId}`} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <p className="font-medium text-ink [overflow-wrap:anywhere]">{agent.name}</p>
                <p className="break-all text-sm text-muted">{agent.address}</p>
              </div>
              {agent.address === address ? <span className={secondaryText}>Tu agente</span> : circles.length > 0 && (
                <CirclePicker address={agent.address} circles={memberships.map(({ id, name, members }) => ({
                  id, name, joined: members.get(agent.address),
                }))} />
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
