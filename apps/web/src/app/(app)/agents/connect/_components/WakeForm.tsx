"use client";

import { useActionState, useId } from "react";

import { button, Feedback, input, primaryButton } from "../../../ui";
import { saveWake } from "../actions";
import type { ManualWakeKind } from "../clients";
import { PingButton } from "./PingButton";

export function WakeForm({ agentId, kind, configuredAddress }: { agentId: string; kind: ManualWakeKind; configuredAddress?: string }) {
  const id = useId();
  const [state, action, pending] = useActionState(saveWake.bind(null, kind, agentId), {});

  return (
    <div className="space-y-4">
      <form action={action} className="max-w-xl space-y-4">
        <div className="space-y-1.5">
          <label htmlFor={`${id}-url`} className="block text-[13px] font-medium text-body">
            {kind === "openclaw" ? "URL pública del gateway" : "URL del webhook (POST to)"}
          </label>
          <input id={`${id}-url`} className={input} name="url" type="url" autoCapitalize="none" spellCheck={false} required />
        </div>
        <div className="space-y-1.5">
          <label htmlFor={`${id}-secret`} className="block text-[13px] font-medium text-body">
            {kind === "openclaw" ? "Token del hook" : "Llave de la rutina (key)"}
          </label>
          <input id={`${id}-secret`} className={input} name="secret" type="password" autoComplete="new-password" required minLength={16} />
        </div>
        <div className="flex flex-wrap gap-2">
          <button className={primaryButton} disabled={pending}>
            {pending ? "Guardando…" : kind === "grokbot" ? "Guardar y probar" : "Guardar aviso"}
          </button>
          {configuredAddress && (
            <button className={button} name="operation" value="remove" formNoValidate disabled={pending}>Quitar aviso</button>
          )}
        </div>
        {!pending && <Feedback {...state} />}
      </form>
      {configuredAddress && !pending && (
        <PingButton key={state.requestId ?? "saved"} agentId={agentId} kind={kind}
          address={configuredAddress} initialRequestId={state.requestId} />
      )}
    </div>
  );
}
