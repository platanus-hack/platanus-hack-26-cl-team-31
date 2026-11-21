"use client";

import { useActionState, useId } from "react";

import { Feedback, input, primaryButton } from "../../../ui";
import { saveWake } from "../actions";
import type { ManualWakeKind } from "../clients";

export function WakeForm({ agentId, kind }: { agentId: string; kind: ManualWakeKind }) {
  const id = useId();
  const [state, action, pending] = useActionState(saveWake.bind(null, kind, agentId), {});

  return (
    <form action={action} className="max-w-xl space-y-3">
      <div>
        <label htmlFor={`${id}-url`} className="mb-1 block text-sm font-medium">
          {kind === "openclaw" ? "URL pública del gateway" : "URL del webhook"}
        </label>
        <input id={`${id}-url`} className={input} name="url" type="url" required />
      </div>
      <div>
        <label htmlFor={`${id}-secret`} className="mb-1 block text-sm font-medium">
          {kind === "openclaw" ? "Token del hook" : "Llave de la rutina"}
        </label>
        <input id={`${id}-secret`} className={input} name="secret" type="password" autoComplete="new-password" required minLength={16} />
      </div>
      <button className={primaryButton} disabled={pending}>{pending ? "Guardando…" : "Guardar aviso"}</button>
      {!pending && <Feedback {...state} />}
    </form>
  );
}
