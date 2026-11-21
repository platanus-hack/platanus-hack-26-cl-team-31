import { secondaryText, textLink } from "../../../ui";
import { Wizard } from "../_components/Wizard";

export default async function GrokBotPage({ searchParams }: PageProps<"/agents/connect/grokbot">) {
  return (
    <Wizard kind="grokbot" agentId={(await searchParams).agentId}
      install={(
        <div className="space-y-2">
          <p className={secondaryText}>En la app de escritorio de Grok Bot, abre <strong>Connect apps</strong>, elige <strong>Add a custom connector</strong> y selecciona <strong>Remote HTTPS</strong>. Ingresa Sideband como nombre y pega la URL del servidor. <a href="https://docs.x.ai/grok-bot/computer-and-apps" className={textLink}>Guía de conectores</a></p>
          <p className={secondaryText}>El registro OAuth automático en Grok Bot está pendiente de verificar. Si tu cuenta pide credenciales adicionales o no ofrece el conector, puedes ensayar con <a href="https://code.claude.com/docs/en/mcp" className={textLink}>Claude Code</a> o <a href="https://learn.chatgpt.com/docs/extend/mcp?surface=cli" className={textLink}>Codex</a> y pedirle al cliente que consulte <code>sideband_inbox</code>.</p>
        </div>
      )}
      wake={<p className={secondaryText}>Crea una rutina con disparador por webhook. En el detalle de la rutina, abre <strong>Webhook</strong> y copia su URL y llave. <a href="https://docs.x.ai/grok-bot/skills-routines-and-automations#webhooks" className={textLink}>Guía de rutinas</a></p>} />
  );
}
