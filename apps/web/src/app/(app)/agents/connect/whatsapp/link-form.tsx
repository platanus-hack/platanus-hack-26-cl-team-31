"use client";

import { useRouter } from "next/navigation";
import { useActionState } from "react";
import { button, Feedback, primaryButton, secondaryText, textLink } from "../../../ui";
import { updatePhone } from "./actions";

export function LinkForm({ number, linked, pending }: {
  number?: string;
  linked?: string | null;
  pending?: { id: string; phone: string | null };
}) {
  const [state, action, busy] = useActionState(updatePhone, {});
  const router = useRouter();
  const chat = number ? `https://wa.me/${number.slice(1)}` : undefined;
  return (
    <form action={action} className="space-y-4">
      {linked ? <>
        <p>Vinculado a <strong>{linked}</strong>.</p>
        <p className={secondaryText}>Desde ese número puedes enviar solicitudes y ver sus respuestas usando tu cuenta de Sideband.</p>
        <div className="flex flex-wrap gap-3">
          {chat && <a href={chat} target="_blank" rel="noreferrer" className={primaryButton}>Abrir chat</a>}
          <button name="action" value="unlink" className={button} disabled={busy}>Desvincular</button>
        </div>
      </> : !chat ? <p className={secondaryText}>WhatsApp aún no está disponible en este entorno.</p> :
        pending?.phone ? <>
          <p>Detectamos <strong>{pending.phone}</strong>. Confirma solo si es tu número.</p>
          <input type="hidden" name="id" value={pending.id} />
          <button name="action" value="confirm" className={primaryButton} disabled={busy}>Confirmar vínculo</button>
        </> : <>
          <p className={secondaryText}>Genera un código, envíalo desde tu WhatsApp y vuelve aquí para confirmar. El código vence en 10 minutos.</p>
          {pending && state.code && <div className="flex flex-wrap items-center gap-3">
            <a href={`${chat}?text=${encodeURIComponent(`VINCULAR ${state.code}`)}`} target="_blank" rel="noreferrer" className={primaryButton}>Enviar código en WhatsApp</a>
            <button type="button" className={`${textLink} cursor-pointer`} onClick={() => router.refresh()}>Ya envié el código</button>
          </div>}
        </>}
      {!linked && chat && <button name="action" value="start" className={pending ? button : primaryButton} disabled={busy}>
        {pending ? "Generar otro código" : "Generar código"}
      </button>}
      <Feedback {...state} />
    </form>
  );
}
