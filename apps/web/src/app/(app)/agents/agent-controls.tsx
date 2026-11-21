"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import { pingOrRevokeAgent } from "./actions";
import { button, Feedback } from "../ui";

export function AgentControls({ agentId, revoked }: { agentId: string; revoked: boolean }) {
  const [confirm, setConfirm] = useState(false);
  const [state, submit, pending] = useActionState(pingOrRevokeAgent.bind(null, agentId), {});
  const [operation, setOperation] = useState<string>();
  const optimistic = pending && !state.error;
  const pinging = optimistic && operation === "ping";
  const revoking = optimistic && operation === "revoke";

  return (
    <form action={submit} onSubmit={(event) => setOperation((event.nativeEvent as SubmitEvent).submitter?.getAttribute("value") ?? undefined)} className="space-y-2">
      {revoking && <p role="status" className="text-[13px] font-medium text-accent-ink">Agente desconectado.</p>}
      {!revoked && !revoking && (!confirm ? (
        <div className="flex flex-wrap gap-2">
          <button name="operation" value="ping" disabled={pending} className={button}>Probar</button>
          <Link prefetch={false} href={`/agents/connect?agentId=${encodeURIComponent(agentId)}`} className={button}>Configurar aviso</Link>
          <button type="button" onClick={() => setConfirm(true)} disabled={pending} className={button}>Desconectar</button>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-sm font-medium">¿Desconectar este agente?</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setConfirm(false)} disabled={pending} className={button}>Cancelar</button>
            <button name="operation" value="revoke" disabled={pending}
              className={`${button} border-danger-line text-danger hover:bg-danger-bg`}>Confirmar desconexión</button>
          </div>
        </div>
      ))}
      {pinging ? <p role="status" className="text-[13px] font-medium text-accent-ink">Prueba solicitada. Revisa su estado en Actividad.</p> : !revoking && <Feedback {...state} />}
    </form>
  );
}
