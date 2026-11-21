import Link from "next/link";
import type { ReactNode } from "react";

import { button, Heading, input, secondaryText, textLink } from "../../../ui";
import { selectConnection } from "../actions";
import { clients, type ClientKind } from "../clients";
import { listConnections } from "../connections";
import { CopyBox } from "./CopyBox";
import { PingButton } from "./PingButton";
import { Step, Steps } from "./Steps";
import { TrustSnippet } from "./TrustSnippet";
import { WakeForm } from "./WakeForm";

type WizardProps = {
  kind: ClientKind;
  agentId: string | string[] | undefined;
  install: ReactNode;
  login?: ReactNode;
  wake?: ReactNode;
};

export async function Wizard({ kind, agentId, install, login, wake }: WizardProps) {
  const client = clients[kind];
  const connections = await listConnections();
  const selected = connections.find((connection) => connection.agentId === agentId);
  const wakeReady = selected?.wakeKind === client.wakeKind;
  const path = `/agents/connect/${kind}`;
  const refreshUrl = selected ? `${path}?agentId=${encodeURIComponent(selected.agentId)}` : path;
  const resourceUrl = process.env.MCP_RESOURCE_URL;

  return (
    <div className="max-w-3xl">
      <Link href="/agents/connect" className={`${textLink} mb-5 inline-block text-sm`}>Cambiar tipo de bot</Link>
      <Heading title={`Conectar ${client.name}`}>{client.description}</Heading>

      <Steps>
        <Step number={1} title="Agregar Nexo">
          {install}
          {resourceUrl ? (
            <CopyBox label={kind === "openclaw" ? "Configuración MCP para openclaw.json" : "URL del servidor MCP"}
              value={kind === "openclaw"
                ? JSON.stringify({ mcp: { servers: { nexo: { url: resourceUrl, transport: "streamable-http", auth: "oauth" } } } }, null, 2)
                : resourceUrl} />
          ) : (
            <p role="alert" className={secondaryText}>Falta configurar la URL del servidor MCP en Nexo.</p>
          )}
        </Step>

        <Step number={2} title="Autorizar en Nexo">
          {login}
          <p className={secondaryText}>Cuando el cliente abra Nexo, revisa los permisos en la pantalla de autorización y elige <strong>Autorizar</strong>. De vuelta en tu cliente, pídele al agente que consulte <code>nexo_inbox</code> y luego actualiza la lista.</p>
          {agentId !== undefined && !selected && (
            <p role="status" className="text-sm text-[#792f26]">No se encontró esa conexión. Selecciona un agente de tu cuenta.</p>
          )}
          {selected && <p className="text-sm font-semibold text-[#28513b] [overflow-wrap:anywhere]">Conexión seleccionada: {selected.label}</p>}
          <div className="flex flex-wrap items-end gap-2">
            {connections.length > 0 && (
              <form action={selectConnection.bind(null, kind)} className="flex flex-wrap items-end gap-2">
                <label className="block min-w-0 text-sm font-semibold">
                  Agente autorizado
                  <select className={`${input} mt-1 block max-w-64`} name="agentId" defaultValue={selected?.agentId ?? ""} required>
                    <option value="" disabled>Selecciona un agente</option>
                    {connections.map((connection) => (
                      <option key={connection.agentId} value={connection.agentId}>{connection.label}</option>
                    ))}
                  </select>
                </label>
                <button className={button}>Usar este agente</button>
              </form>
            )}
            <a href={refreshUrl} className={button}>Actualizar conexiones</a>
          </div>
          {connections.length === 0 && <p className={secondaryText}>Aún no hay agentes conectados en esta cuenta.</p>}
          <TrustSnippet location={client.trustLocation} />
        </Step>

        <Step number={3} title="Configurar el aviso">
          {wake}
          {client.wakeInstruction && <CopyBox label="Instrucción para activar el aviso" value={client.wakeInstruction} />}
          {wakeReady && (
            <p className="text-sm font-semibold text-[#28513b]">
              {kind === "dot" ? "Aviso conectado mediante eventos MCP." : "El agente ya tiene un aviso configurado."}
            </p>
          )}
          {kind === "dot" ? (
            <p className={secondaryText}>Después de que Dot se suscriba, <a href={refreshUrl} className={textLink}>actualiza las conexiones</a> para confirmar el aviso.</p>
          ) : selected ? (
            <WakeForm key={selected.agentId} kind={kind} agentId={selected.agentId} />
          ) : (
            <p className={secondaryText}>Selecciona tu agente autorizado en el paso anterior para guardar el aviso.</p>
          )}
        </Step>

        <Step number={4} title="Probar la conexión">
          <p className={secondaryText}>Envía una solicitud de prueba y comprueba aquí que el agente la recibió.</p>
          {selected && wakeReady ? (
            <PingButton key={selected.agentId} agentId={selected.agentId} kind={kind} />
          ) : (
            <p className={secondaryText}>El botón Probar aparece cuando el agente seleccionado tiene el aviso configurado.</p>
          )}
        </Step>
      </Steps>
    </div>
  );
}
