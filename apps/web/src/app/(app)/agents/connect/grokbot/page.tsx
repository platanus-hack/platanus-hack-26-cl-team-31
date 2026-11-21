import { secondaryText, textLink } from "../../../ui";
import { Wizard } from "../_components/Wizard";

export default async function GrokBotPage({ searchParams }: PageProps<"/agents/connect/grokbot">) {
  return (
    <Wizard kind="grokbot" agentId={(await searchParams).agentId}
      install={(
        <div className="space-y-2">
          <p className={secondaryText}>En la app de escritorio de Grok Bot, abre <strong>Connect apps</strong>, elige <strong>Add a custom connector</strong> y selecciona <strong>Remote HTTPS</strong>. Ingresa Sideband como nombre y pega la URL del servidor. <a href="https://docs.x.ai/grok-bot/computer-and-apps" className={textLink}>Guía de conectores</a></p>
          <p className={secondaryText}>Deja vacíos los campos de credenciales OAuth, guarda el conector y pulsa <strong>Connect</strong> para autorizar tu cuenta de Sideband.</p>
        </div>
      )}
      wake={<p className={secondaryText}>Abre <strong>Routines → tu rutina → Webhook</strong> en Grok. Copia <strong>POST to</strong> y <strong>key</strong> en los campos de Sideband. Selecciona <strong>Guardar y probar</strong> para enviarle una solicitud a la rutina. <a href="https://docs.x.ai/grok-bot/skills-routines-and-automations#webhooks" className={textLink}>Guía de rutinas</a></p>} />
  );
}
