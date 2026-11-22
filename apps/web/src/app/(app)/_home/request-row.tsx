"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import type { OwnerPendingItem } from "@team-31/protocol";
import { categories } from "@team-31/protocol/constants";

import { decide } from "../actions";
import { formatSlotDay } from "../labels";
import { Modal, ModalCancel, useCloseModal } from "../modal";
import { button, Feedback, Initial, input, primaryButton } from "../ui";

function summary(item: OwnerPendingItem) {
  switch (item.tool) {
    case "availability": return `¿Estás libre el ${formatSlotDay(item.args.date)} · ${item.args.start} (${item.args.durationMinutes} min)?`;
    case "interest_check": return `¿Te interesa ${item.args.interest}?`;
    case "question": return `Pregunta sobre ${categories[item.args.category ?? "general"].label}`;
    case "vault_access": return `Quiere leer «${item.args.categoryName}» de tu bóveda`;
    case "connect": return "Quiere conectar contigo";
    case "profile": return "Quiere ver tu perfil";
  }
}

function choices(item: OwnerPendingItem): [string, string, string, string] | undefined {
  if (item.tool === "vault_access") return ["grant_vault_read", "Conceder", "deny", "Rechazar"];
  if (!item.escalated) return ["approve_once", "Aprobar", "deny", "Rechazar"];
  if (item.tool === "availability") return ["yes", "Sí puedo", "no", "No puedo"];
  if (item.tool === "interest_check") return ["yes", "Me interesa", "no", "No"];
  if (item.tool === "connect") return ["yes", "Aceptar", "no", "No conectar"];
  return undefined;
}

type Result = { error?: string; message?: string; errorId?: string };

const initial: Result = {};

function AnswerForm({ item }: { item: OwnerPendingItem }) {
  const [state, submit, pending] = useActionState(decide.bind(null, item.requestId), initial);
  const [answer, setAnswer] = useState("");
  const close = useCloseModal();
  useEffect(() => { if (state.message) close(); }, [state, close]);
  const message = [item.senderMessage.text, item.senderMessage.purpose].filter(Boolean).join("\n");
  return (
    <form action={submit} className="space-y-5">
      {item.tool === "question" && <p className="text-sm text-ink">{item.args.text}</p>}
      <div className="rounded-xl stage p-3 text-[13px]">
        <p className="text-muted">Mensaje de {item.from}</p>
        <p className="mt-1 whitespace-pre-wrap text-body [overflow-wrap:anywhere]">{message || "Sin mensaje."}</p>
      </div>
      <label className="block space-y-1.5">
        <span className="text-[13px] font-medium text-body">Tu respuesta</span>
        <textarea name="answer" value={answer} onChange={(event) => setAnswer(event.target.value)} rows={3} maxLength={1000} autoFocus
          className={`${input} h-auto py-2`} />
      </label>
      <Feedback error={state.error} errorId={state.errorId} />
      <div className="flex justify-between gap-2 pt-1">
        <button className={button} name="decision" value="deny" disabled={pending}>Prefiero no compartir</button>
        <div className="flex gap-2">
          <ModalCancel />
          <button className={primaryButton} name="decision" value="answer" disabled={pending || !answer.trim()}>Responder</button>
        </div>
      </div>
    </form>
  );
}

function useDecision(item: OwnerPendingItem) {
  const [state, submit, pending] = useActionState(decide.bind(null, item.requestId), initial);
  const [declining, setDeclining] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const negative = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!declining) return;
    const timer = setTimeout(() => {
      form.current?.requestSubmit(negative.current);
      setDeclining(false);
    }, 5000);
    return () => clearTimeout(timer);
  }, [declining]);
  const quick = choices(item);
  const gone = (pending || state.message) && !state.error;
  const hiddenForm = quick && (
    <form ref={form} action={submit} hidden>
      <button ref={negative} name="decision" value={quick[2]} />
    </form>
  );
  const undo = (
    <>
      <span>Rechazaste la solicitud de {item.from}.</span>
      {!pending && <button type="button" onClick={() => setDeclining(false)} className="cursor-pointer font-medium text-accent-ink hover:underline">Deshacer</button>}
      {hiddenForm}
    </>
  );
  return { state, submit, pending, quick, gone, undoing: declining, undo, decline: () => setDeclining(true) };
}

export function RequestRow({ item, expires }: { item: OwnerPendingItem; expires: string }) {
  const { state, submit, pending, quick, gone, undoing, undo, decline } = useDecision(item);
  const message = item.senderMessage.text || item.senderMessage.purpose;

  if (undoing) return <li className="flex items-center justify-between gap-3 px-4 py-3 text-[13px] text-muted">{undo}</li>;

  return (
    <li className={`flex flex-wrap items-center gap-3 px-4 py-3 ${gone ? "hidden" : ""}`}>
      <Initial name={item.from} />
      <div className="min-w-48 flex-1">
        <p className="text-sm text-ink [overflow-wrap:anywhere]"><span className="font-medium">{item.from}</span> <span className="text-body">· {summary(item)}</span></p>
        <p className="line-clamp-1 text-xs text-muted">{message ? `“${message}”` : "Sin mensaje"}</p>
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-2">
        <span className="text-xs text-muted tabular-nums">{expires}</span>
        {quick ? (
          <form action={submit} className="flex items-center gap-2">
            <button type="button" className={button} onClick={decline} disabled={pending}>{quick[3]}</button>
            <button className={primaryButton} name="decision" value={quick[0]} disabled={pending}>{quick[1]}</button>
          </form>
        ) : (
          <Modal label="Responder" title={`Responder a ${item.from}`} trigger="Responder" triggerClassName={primaryButton}>
            <AnswerForm item={item} />
          </Modal>
        )}
      </div>
      {state.error && <div className="basis-full"><Feedback {...state} /></div>}
    </li>
  );
}

export function FocusRequest({ item, expires }: { item: OwnerPendingItem; expires: string }) {
  const { state, submit, pending, quick, gone, undoing, undo, decline } = useDecision(item);
  const message = [item.senderMessage.text, item.senderMessage.purpose].filter(Boolean).join(" ");

  if (undoing) return <div className="flex items-center justify-between gap-3 rounded-2xl bg-card px-6 py-5 text-[13px] text-muted">{undo}</div>;

  return (
    <div className={`rounded-2xl bg-card p-6 ${gone ? "hidden" : ""}`}>
      <div className="flex items-center gap-3">
        <Initial name={item.from} />
        <p className="min-w-0 flex-1 truncate text-[13px] text-muted"><span className="font-medium text-ink">{item.from}</span> te pregunta</p>
        <span className="shrink-0 rounded-full bg-warn-bg px-2.5 py-1 text-xs font-medium text-warn">Vence {expires}</span>
      </div>
      <p className="mt-5 text-lg leading-snug font-medium tracking-[-0.01em] text-white sm:text-xl">{summary(item)}</p>
      {message && <p className="mt-3 max-w-xl rounded-2xl rounded-tl-md bg-white/6 px-4 py-2.5 text-sm text-body [overflow-wrap:anywhere]">{message}</p>}
      <div className="mt-6 flex flex-wrap items-center gap-2">
        {quick ? (
          <form action={submit} className="flex items-center gap-2">
            <button className={`${primaryButton} h-9 px-4`} name="decision" value={quick[0]} disabled={pending}>{quick[1]}</button>
            <button type="button" className={`${button} h-9 px-4`} onClick={decline} disabled={pending}>{quick[3]}</button>
          </form>
        ) : (
          <Modal label="Responder" title={`Responder a ${item.from}`} trigger="Responder" triggerClassName={`${primaryButton} h-9 px-4`}>
            <AnswerForm item={item} />
          </Modal>
        )}
      </div>
      {state.error && <div className="mt-3"><Feedback {...state} /></div>}
    </div>
  );
}
