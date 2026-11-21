"use client";

import type { RequestStatus } from "@team-31/protocol";
import { useActionState, useEffect, useState } from "react";

import { button, Feedback, primaryButton, secondaryText, Status } from "../../../ui";
import { readPingStatus, startPing } from "../actions";
import type { ClientKind } from "../clients";
import { CopyBox } from "./CopyBox";

const descriptions: Record<RequestStatus, string> = {
  awaiting_agent: "Prueba enviada. Esperando al agente.",
  awaiting_owner: "El agente pidió tu decisión. Revisa las solicitudes de Sideband.",
  answered: "La prueba se cerró sin una respuesta final del agente. Vuelve a probar.",
  no_data: "La prueba se cerró sin confirmar la respuesta del agente. Vuelve a probar.",
  delivery_failed: "El aviso falló. Revisa la configuración del aviso y vuelve a probar.",
  expired: "La prueba venció sin que el agente respondiera.",
  declined: "El agente rechazó la prueba.",
  denied: "La prueba fue denegada.",
};

type PingResult = {
  requestId: string;
  ping?: { status: RequestStatus; verified: boolean };
  readError?: true | string;
};

export function PingButton({ agentId, kind, address, initialRequestId }: { agentId: string; kind: ClientKind; address: string; initialRequestId?: string }) {
  const [state, action, sending] = useActionState(startPing.bind(null, kind, agentId), { requestId: initialRequestId });
  const [result, setResult] = useState<PingResult>();
  const requestId = state.requestId;
  const current = result?.requestId === requestId ? result : undefined;
  const missing = current && !current.ping && !current.readError;
  const status = requestId && !missing ? current?.ping?.status ?? "awaiting_agent" : undefined;
  const verified = current?.ping?.verified;
  const waiting = status === "awaiting_agent" || status === "awaiting_owner";

  useEffect(() => {
    if (!requestId || !waiting) return;

    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    function showReadError(id: string, error: true | string) {
      setResult((previous) => ({
        requestId: id,
        ping: previous?.requestId === id ? previous.ping : undefined,
        readError: error,
      }));
    }
    async function poll(id: string) {
      try {
        const response = await readPingStatus(id);
        if (!active) return;
        if (response && "errorId" in response && response.errorId) showReadError(id, response.errorId);
        else if (response?.status) setResult({ requestId: id, ping: response });
        else setResult({ requestId: id });
      } catch {
        if (active) showReadError(id, true);
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
        <button disabled={sending || waiting} className={kind === "grokbot" ? button : primaryButton}>{sending ? "Enviando…" : "Probar"}</button>
      </form>
      <Feedback error={state.error} errorId={state.errorId} />
      <div role="status" className="space-y-2">
        {verified ? (
          <p className="text-sm font-medium text-accent-ink">El agente respondió a la prueba.</p>
        ) : status && (
          <>
            <Status status={status} />
            <p className={secondaryText}>{descriptions[status]}</p>
          </>
        )}
        {missing && <p className={secondaryText}>La prueba ya no está disponible. Vuelve a probar.</p>}
        {current?.readError && (
          <p className={secondaryText}>
            Se perdió la actualización. Volveremos a consultar el estado.
            {typeof current.readError === "string" && <> Código de error <code>{current.readError}</code>.</>}
          </p>
        )}
      </div>
      {verified && !sending && (
        <>
          <CopyBox label="Dirección Sideband" value={address} copyLabel="Copiar mi dirección Sideband" />
          <p className={secondaryText}>Comparte tu dirección para que puedan enviarte solicitudes.</p>
        </>
      )}
    </div>
  );
}
