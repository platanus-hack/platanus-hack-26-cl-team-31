"use client";

import { useActionState, useEffect } from "react";

import { createCircle, inviteToCircle } from "./actions";
import { Feedback, input, primaryButton } from "../ui";
import { Modal, ModalCancel, useCloseModal } from "../modal";

type Result = { error?: string; message?: string; errorId?: string };

const initial: Result = {};

function CreateCircleForm() {
  const [state, submit, pending] = useActionState(createCircle, initial);
  const close = useCloseModal();
  useEffect(() => { if (state !== initial && !state.error) close(); }, [state, close]);
  return (
    <form action={submit} className="space-y-5">
      <div className="space-y-1.5">
        <label htmlFor="circle-name" className="text-[13px] font-medium text-body">Nombre del círculo</label>
        <input id="circle-name" name="name" required autoFocus maxLength={60} placeholder="Fútbol del sábado" className={input} />
      </div>
      <Feedback error={state.error} errorId={state.errorId} />
      <div className="flex justify-end gap-2 pt-1">
        <ModalCancel />
        <button className={primaryButton} disabled={pending}>{pending ? "Creando…" : "Crear círculo"}</button>
      </div>
    </form>
  );
}

export function CreateCircle() {
  return (
    <Modal label="Crear círculo" title="Nuevo círculo" description="Después invitas a los miembros. Cada uno acepta antes de entrar.">
      <CreateCircleForm />
    </Modal>
  );
}

export function InviteMember({ circleId, circleName }: { circleId: string; circleName: string }) {
  const [state, submit, pending] = useActionState(inviteToCircle.bind(null, circleId), {});
  return (
    <form action={submit} className="space-y-2">
      <div className="flex flex-wrap items-start gap-2">
        <input name="address" required placeholder="nombre@sideband.app" autoCapitalize="none" spellCheck={false}
          aria-label={`Dirección Sideband para invitar a ${circleName}`} className={`${input} min-w-48 flex-1`} />
        <button className={primaryButton} disabled={pending}>{pending ? "Invitando…" : "Invitar"}</button>
      </div>
      <Feedback {...state} />
    </form>
  );
}

export function CircleButton({ action, className, label, children }: {
  action: () => Promise<Result>; className: string; label?: string; children: string;
}) {
  const [state, submit, pending] = useActionState(action, {});
  return (
    <form action={submit} className="flex items-center gap-2">
      <Feedback {...state} />
      <button className={className} disabled={pending} aria-label={label}>{children}</button>
    </form>
  );
}
