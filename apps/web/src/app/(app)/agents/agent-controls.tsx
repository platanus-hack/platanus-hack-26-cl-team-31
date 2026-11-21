"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import { pingOrRevokeAgent } from "../actions";
import { button, Feedback } from "../ui";

export function AgentControls({ agentId, revoked }: { agentId: string; revoked: boolean }) {
  const [confirm, setConfirm] = useState(false);
  const [state, submit, pending] = useActionState(pingOrRevokeAgent.bind(null, agentId), {});

  return (
    <form action={submit} className="space-y-2">
      {!revoked && (!confirm ? (
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
      <Feedback {...state} />
    </form>
  );
}
