"use client";

import { useActionState, useState } from "react";
import type { ToolName } from "@team-31/protocol";

import { decide } from "./actions";
import { button, Feedback, input, primaryButton } from "./ui";

export function DecisionForm({ id, tool, escalated }: { id: string; tool: ToolName; escalated: boolean }) {
  const [state, submit, pending] = useActionState(decide.bind(null, id), {});
  const [answer, setAnswer] = useState("");
  const isQuestion = escalated && tool === "question";

  return (
    <form action={submit} className="mt-4 space-y-3">
      {isQuestion && (
        <label className="block text-sm font-semibold">
          Tu respuesta
          <textarea name="answer" value={answer} onChange={(event) => setAnswer(event.target.value)}
            rows={3} maxLength={1000} className={`${input} mt-1 block`} />
        </label>
      )}
      <div className="flex flex-wrap gap-2">
        {!escalated && <button className={primaryButton} name="decision" value="approve_once" disabled={pending}>Aprobar una vez</button>}
        {escalated && tool === "availability" && (
          <>
            <button className={primaryButton} name="decision" value="yes" disabled={pending}>Sí puedo</button>
            <button className={button} name="decision" value="no" disabled={pending}>No puedo</button>
          </>
        )}
        {escalated && tool === "interest_check" && (
          <>
            <button className={primaryButton} name="decision" value="yes" disabled={pending}>Sí me interesa</button>
            <button className={button} name="decision" value="no" disabled={pending}>No me interesa</button>
          </>
        )}
        {escalated && tool === "connect" && (
          <>
            <button className={primaryButton} name="decision" value="yes" disabled={pending}>Aceptar conexión</button>
            <button className={button} name="decision" value="no" disabled={pending}>No conectar</button>
          </>
        )}
        {isQuestion && <button className={primaryButton} name="decision" value="answer" disabled={pending || !answer.trim()}>Responder</button>}
        <button className={button} name="decision" value="deny" disabled={pending}>{escalated ? "Prefiero no compartir" : "Rechazar"}</button>
      </div>
      <Feedback {...state} />
    </form>
  );
}
