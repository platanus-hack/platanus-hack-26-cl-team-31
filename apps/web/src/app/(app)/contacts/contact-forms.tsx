"use client";

import { useActionState, useState } from "react";
import { basicSharing, type Contact, type Invitation, type Sharing } from "@team-31/protocol";

import { answerInvitation, removeContact, saveSharing, sendInvitation } from "../actions";
import { button, card, Feedback, input, primaryButton } from "../ui";
import { describeSharing } from "./describe";
import { SharingPicker } from "./sharing";

const dangerButton = "inline-flex min-h-10 cursor-pointer items-center justify-center rounded-lg px-3.5 py-2 text-sm font-semibold text-danger transition hover:bg-danger-bg disabled:cursor-wait disabled:opacity-60";

export function InviteForm() {
  const [state, submit, pending] = useActionState(sendInvitation, {});
  const [share, setShare] = useState<Sharing>(basicSharing);
  const [editing, setEditing] = useState(false);
  return (
    <form action={submit} className={`${card} space-y-4 p-5 sm:p-6`}>
      <div>
        <h2 className="text-lg font-semibold">Invitar a alguien</h2>
        <p className="text-sm text-muted">Si acepta, quedan conectados y esa persona elige qué te comparte.</p>
      </div>
      <div className="flex flex-wrap items-start gap-2">
        <label htmlFor="invite-to" className="sr-only">Dirección Nexo</label>
        <input id="invite-to" name="to" required placeholder="nombre@nexo.app" autoCapitalize="none" autoComplete="off"
          spellCheck={false} className={`${input} min-w-48 flex-1`} />
        <button className={primaryButton} disabled={pending}>{pending ? "Enviando…" : "Enviar invitación"}</button>
      </div>
      <div className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
          <p><span className="text-muted">Le compartirás:</span> <span className="font-medium">{describeSharing(share)}</span></p>
          <button type="button" className="cursor-pointer font-semibold text-accent hover:underline" aria-expanded={editing}
            onClick={() => setEditing(!editing)}>{editing ? "Listo" : "Cambiar"}</button>
        </div>
        <div hidden={!editing}><SharingPicker value={share} onChange={setShare} /></div>
      </div>
      <Feedback {...state} />
    </form>
  );
}

export function IncomingInvitation({ invitation }: { invitation: Invitation }) {
  const [state, submit, pending] = useActionState(answerInvitation.bind(null, invitation.requestId), {});
  const [share, setShare] = useState<Sharing>(basicSharing);
  return (
    <li className={`${card} space-y-4 p-5`}>
      <div>
        <h3 className="break-all font-semibold">{invitation.address}</h3>
        <p className="text-sm text-muted">Quiere conectar contigo.</p>
      </div>
      <p className="text-sm"><span className="text-muted">Te compartirá:</span> <span className="font-medium">{describeSharing(invitation.offer)}</span></p>
      <form action={submit} className="space-y-3">
        <p className="text-sm font-semibold">Tú le compartirás</p>
        <SharingPicker value={share} onChange={setShare} />
        <div className="flex flex-wrap gap-2">
          <button className={primaryButton} name="answer" value="accept" disabled={pending}>Aceptar</button>
          <button className={button} name="answer" value="decline" disabled={pending}>Rechazar</button>
        </div>
        <Feedback {...state} />
      </form>
    </li>
  );
}

function sameSharing(a: Sharing, b: Sharing) {
  return a.availability === b.availability && a.interests === b.interests && a.questions === b.questions;
}

export function ContactRow({ contact }: { contact: Contact }) {
  const [state, submit, pending] = useActionState(saveSharing.bind(null, contact.address), {});
  const [removeState, remove, removing] = useActionState(removeContact.bind(null, contact.address), {});
  const [share, setShare] = useState<Sharing>(contact.gives);
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const dirty = !sameSharing(share, contact.gives);

  return (
    <li className={card}>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}
        className="flex w-full cursor-pointer items-center justify-between gap-4 px-5 py-4 text-left">
        <div className="min-w-0 space-y-1">
          <p className="break-all font-semibold">{contact.address}</p>
          <p className="text-sm"><span className="text-muted">Le compartes:</span> {describeSharing(contact.gives)}</p>
          <p className="text-sm"><span className="text-muted">Te comparte:</span> {describeSharing(contact.receives)}</p>
        </div>
        <span aria-hidden="true" className={`text-xl text-muted transition-transform ${open ? "rotate-90" : ""}`}>›</span>
      </button>
      {open && (
        <div className="space-y-4 border-t border-line px-5 py-4">
          <form action={submit} className="space-y-3">
            <p className="text-sm font-semibold">Lo que le compartes</p>
            <SharingPicker value={share} onChange={setShare} />
            <div className="flex flex-wrap items-center gap-3">
              <button className={primaryButton} disabled={pending || !dirty}>{pending ? "Guardando…" : "Guardar"}</button>
              {dirty && <button type="button" className={button} onClick={() => setShare(contact.gives)}>Deshacer</button>}
              <Feedback {...(dirty ? {} : state)} />
            </div>
          </form>
          <form action={remove} className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
            {confirming ? (
              <>
                <p className="text-sm text-muted">Se quitarán los permisos directos de ambos. Los permisos de círculos compartidos seguirán activos.</p>
                <button className={dangerButton} disabled={removing}>Sí, dejar de ser contactos</button>
                <button type="button" className={button} onClick={() => setConfirming(false)}>Cancelar</button>
              </>
            ) : (
              <button type="button" className={dangerButton} onClick={() => setConfirming(true)}>Dejar de ser contactos</button>
            )}
            <Feedback {...removeState} />
          </form>
        </div>
      )}
    </li>
  );
}
