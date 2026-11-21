"use client";

import { useActionState } from "react";

import { removeFriend, sendConnection } from "../actions";
import { button, Feedback, input, primaryButton } from "../ui";

export function ConnectForm() {
  const [state, submit, pending] = useActionState(sendConnection, {});
  return (
    <form action={submit} className="space-y-2">
      <label htmlFor="connect-to" className="block text-sm font-medium">Dirección Nexo</label>
      <div className="flex flex-wrap items-start gap-2">
        <input id="connect-to" name="to" required placeholder="nombre@nexo.app" autoCapitalize="none" spellCheck={false}
          className={`${input} min-w-48 flex-1`} />
        <button className={primaryButton} disabled={pending}>{pending ? "Enviando…" : "Enviar solicitud"}</button>
      </div>
      <Feedback {...state} />
    </form>
  );
}

export function RemoveFriend({ address }: { address: string }) {
  const [state, submit, pending] = useActionState(removeFriend.bind(null, address), {});
  return (
    <form action={submit} className="flex items-center gap-2">
      <Feedback {...state} />
      <button className={button} disabled={pending} aria-label={`Quitar a ${address}`}>Quitar</button>
    </form>
  );
}
