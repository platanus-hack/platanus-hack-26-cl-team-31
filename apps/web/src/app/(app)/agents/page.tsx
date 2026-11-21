import Link from "next/link";

import { readAgents } from "../actions";
import { wakeLabels } from "../labels";
import { card, Empty, Heading, primaryButton, Stamp } from "../ui";
import { AgentControls } from "./agent-controls";

export default async function AgentsPage() {
  const agents = await readAgents();

  return (
    <>
      <Heading title="Agentes" action={<Link href="/agents/connect" prefetch={false} className={primaryButton}>Conectar con Sideband</Link>}>
        Revisa tus conexiones y cómo reciben avisos.
      </Heading>
      {agents.length === 0 ? <Empty>Aún no tienes agentes conectados.</Empty> : (
        <div className={`${card} overflow-x-auto`} tabIndex={0} role="region" aria-label="Lista de agentes">
          <table className="w-full min-w-184 text-left text-sm">
            <caption className="sr-only">Agentes conectados y desconectados</caption>
            <thead className="bg-chip-hover text-xs font-medium text-body">
              <tr>
                <th scope="col" className="px-4 py-3">Agente</th>
                <th scope="col" className="px-4 py-3">Tipo de aviso</th>
                <th scope="col" className="px-4 py-3">Verificación</th>
                <th scope="col" className="px-4 py-3">Último aviso</th>
                <th scope="col" className="px-4 py-3">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {agents.map((agent) => (
                <tr key={agent.agentId} className="align-top">
                  <th scope="row" className="max-w-56 px-4 py-4 font-medium [overflow-wrap:anywhere]">
                    {agent.label}
                    <span className={`mt-1 block text-xs font-medium ${agent.revokedAt ? "text-danger" : "text-accent"}`}>
                      {agent.revokedAt ? "Desconectado" : "Conectado"}
                    </span>
                  </th>
                  <td className="px-4 py-4">{wakeLabels[agent.wakeKind]}</td>
                  <td className="px-4 py-4">{agent.verifiedAt ? <Stamp value={agent.verifiedAt} /> : "Pendiente"}</td>
                  <td className="px-4 py-4">{agent.lastWakeAt ? <Stamp value={agent.lastWakeAt} /> : "Sin avisos"}</td>
                  <td className="px-4 py-3"><AgentControls agentId={agent.agentId} revoked={Boolean(agent.revokedAt)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
