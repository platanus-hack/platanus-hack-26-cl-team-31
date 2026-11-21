"use client";

import { useActionState } from "react";

import { createCircle, inviteToCircle } from "../actions";
import { Feedback, input, primaryButton } from "../ui";

type Result = { error?: string; message?: string };

export function CreateCircle() {
  const [state, submit, pending] = useActionState(createCircle, {});
  return (
    <form action={submit} className="space-y-2">
      <label htmlFor="circle-name" className="block text-sm font-medium">Nombre del círculo</label>
      <div className="flex flex-wrap items-start gap-2">
        <input id="circle-name" name="name" required maxLength={60} placeholder="Fútbol del sábado"
          className={`${input} min-w-48 flex-1`} />
        <button className={primaryButton} disabled={pending}>{pending ? "Creando…" : "Crear círculo"}</button>
      </div>
      <Feedback {...state} />
    </form>
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
