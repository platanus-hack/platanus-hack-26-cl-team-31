import Link from "next/link";
import { config } from "@/lib/whatsapp/kapso";
import { askExample } from "@/lib/whatsapp/commands";
import { whatsappStore } from "@/lib/whatsapp/runtime";
import { readAsOwner } from "../../../owner";
import { card, Heading, secondaryText, textLink } from "../../../ui";
import { LinkForm } from "./link-form";

export default async function WhatsAppPage() {
  const { data: state } = await readAsOwner(({ userId }) => whatsappStore().state(userId));
  const kapso = config();
  return (
    <>
      <Link href="/agents/connect" className={`${textLink} mb-5 inline-block text-sm`}>Volver a Conectar</Link>
      <Heading title="Conectar WhatsApp">Usa tu cuenta de Sideband desde tu teléfono, sin abrir un agente.</Heading>
      <div className={`${card} max-w-2xl space-y-5 p-6`}>
        <LinkForm number={kapso?.number} linked={state?.linked}
          pending={state?.id ? { id: state.id, phone: state.phone } : undefined} />
        {kapso && (process.env.ANTHROPIC_API_KEY?.trim() ? <>
          <p className={secondaryText}>Una vez conectado, escribe como hablas: «¿Carla puede jugar el sábado?» o «¿Ya me respondió?».</p>
          <p className={secondaryText}>Para interpretar el texto libre enviamos ese mensaje a Claude (Anthropic), no tu lista de contactos ni las respuestas de tus agentes.</p>
        </> : <p className={secondaryText}>Una vez conectado, escribe «{askExample}» o «estado».</p>)}
      </div>
    </>
  );
}
