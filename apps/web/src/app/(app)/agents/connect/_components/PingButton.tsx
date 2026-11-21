"use client";

import type { RequestStatus } from "@team-31/protocol";
import { useActionState, useEffect, useState } from "react";

import { Feedback, primaryButton, secondaryText, Status } from "../../../ui";
import { readPingStatus, startPing } from "../actions";
import type { ClientKind } from "../clients";

const descriptions: Record<RequestStatus, string> = {
  awaiting_agent: "Prueba enviada. Esperando al agente.",
  awaiting_owner: "El agente pidió tu decisión. Revisa las solicitudes de Nexo.",
  answered: "El agente respondió a la prueba.",
  no_data: "El agente confirmó que recibió la prueba.",
  delivery_failed: "El aviso falló. Revisa la configuración del aviso y vuelve a probar.",
  expired: "La prueba venció sin que el agente respondiera.",
  declined: "El agente rechazó la prueba.",
  denied: "La prueba fue denegada.",
};

export function PingButton({ agentId, kind }: { agentId: string; kind: ClientKind }) {
  const [state, action, sending] = useActionState(startPing.bind(null, kind, agentId), {});
  const [result, setResult] = useState<{ requestId: string; status?: RequestStatus; readError?: boolean }>();
  const requestId = state.requestId;
  const current = result?.requestId === requestId ? result : undefined;
  const status = requestId ? current?.status ?? "awaiting_agent" : undefined;
  const waiting = status === "awaiting_agent" || status === "awaiting_owner";

  useEffect(() => {
    if (!requestId || !waiting) return;

    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function poll(id: string) {
      try {
        const latest = await readPingStatus(id);
        if (active) setResult({ requestId: id, status: latest });
      } catch {
        if (active) setResult((previous) => ({
          requestId: id,
          status: previous?.requestId === id ? previous.status : undefined,
          readError: true,
        }));
      } finally {
        if (active) timer = setTimeout(() => void poll(id), 2000);
      }
    }
    timer = setTimeout(() => void poll(requestId), 1000);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [requestId, waiting]);

  return (
    <div className="space-y-3">
      <form action={action}>
        <button disabled={sending || waiting} className={primaryButton}>{sending ? "Enviando…" : "Probar"}</button>
      </form>
      <Feedback error={state.error} />
      <div role="status" className="space-y-2">
        {status && (
          <>
            <Status status={status} />
            <p className={secondaryText}>{descriptions[status]}</p>
          </>
        )}
        {current?.readError && <p className={secondaryText}>Se perdió la actualización. Volveremos a consultar el estado.</p>}
      </div>
    </div>
  );
}
