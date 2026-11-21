"use client";

import { useActionState, useState, useTransition } from "react";
import type { Contact, Invitation, Sharing, TagPresets } from "@team-31/protocol";
import { contactTagNames, contactTags, type ContactTag } from "@team-31/protocol/constants";

import { answerInvitation, removeContact, saveContactTag, saveSharing, saveTagPreset, sendInvitation } from "../actions";
import { button, card, Feedback, input, primaryButton } from "../ui";
import { describeSharing } from "./describe";
import { SharingPicker } from "./sharing";
import { TagMenu, TagPicker } from "./tags";

const dangerButton = "inline-flex min-h-10 cursor-pointer items-center justify-center rounded-lg px-3.5 py-2 text-sm font-semibold text-danger transition hover:bg-danger-bg disabled:cursor-wait disabled:opacity-60";

export function InviteForm({ presets }: { presets: TagPresets }) {
  const [state, submit, pending] = useActionState(sendInvitation, {});
  const [tag, setTag] = useState<ContactTag>("friend");
  return (
    <form action={submit} className={`${card} space-y-4 p-5 sm:p-6`}>
      <div>
        <h2 className="text-lg font-semibold">Invitar a alguien</h2>
        <p className="text-sm text-muted">Elige su etiqueta. Si acepta, quedan conectados y esa persona elige qué te comparte.</p>
      </div>
      <div className="flex flex-wrap items-start gap-2">
        <label htmlFor="invite-to" className="sr-only">Dirección Sideband</label>
        <input id="invite-to" name="to" required placeholder="nombre@sideband.app" autoCapitalize="none" autoComplete="off"
          spellCheck={false} className={`${input} min-w-48 flex-1`} />
        <button className={primaryButton} disabled={pending}>{pending ? "Enviando…" : "Enviar invitación"}</button>
      </div>
      <TagPicker value={tag} onChange={setTag} name="tag" />
      <p className="text-sm"><span className="text-muted">Le compartirás:</span> <span className="font-medium">{describeSharing(presets[tag])}</span></p>
      <Feedback {...state} />
    </form>
  );
}

export function IncomingInvitation({ invitation, presets }: { invitation: Invitation; presets: TagPresets }) {
  const [state, submit, pending] = useActionState(answerInvitation.bind(null, invitation.requestId), {});
  const [tag, setTag] = useState<ContactTag>("friend");
  return (
    <li className={`${card} space-y-4 p-5`}>
      <div>
        <h3 className="break-all font-semibold">{invitation.address}</h3>
        <p className="text-sm text-muted">Quiere conectar contigo.</p>
      </div>
      <p className="text-sm"><span className="text-muted">Te compartirá:</span> <span className="font-medium">{describeSharing(invitation.offer)}</span></p>
      <form action={submit} className="space-y-3">
        <p className="text-sm font-semibold">¿Qué es para ti?</p>
        <TagPicker value={tag} onChange={setTag} name="tag" />
        <p className="text-sm"><span className="text-muted">Le compartirás:</span> <span className="font-medium">{describeSharing(presets[tag])}</span></p>
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
  return a.length === b.length && a.every((category) => b.includes(category));
}

export function ContactRow({ contact, presets }: { contact: Contact; presets: TagPresets }) {
  const [tagging, startTagging] = useTransition();
  const [tagState, setTagState] = useState<{ error?: string }>({});
  const preset = contact.tag ? presets[contact.tag] : undefined;
  const custom = preset !== undefined && !sameSharing(contact.gives, preset);
  function retag(tag: ContactTag) {
    startTagging(async () => setTagState(await saveContactTag(contact.address, tag)));
  }
  const [state, submit, pending] = useActionState(saveSharing.bind(null, contact.address), {});
  const [removeState, remove, removing] = useActionState(removeContact.bind(null, contact.address), {});
  const [share, setShare] = useState<Sharing>(contact.gives);
  const [base, setBase] = useState<Sharing>(contact.gives);
  if (!sameSharing(base, contact.gives)) {
    setBase(contact.gives);
    setShare(contact.gives);
  }
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const dirty = !sameSharing(share, contact.gives);

  return (
    <li className={card}>
      <div className="flex items-center gap-3 px-5 py-4">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <p className="break-all font-semibold">{contact.address}</p>
          <TagMenu value={contact.tag} custom={custom} disabled={tagging} onChange={retag} />
        </div>
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-label={open ? "Ocultar opciones" : "Ver opciones"}
          className="-mr-2 inline-flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-md text-xl text-muted transition hover:bg-chip-hover hover:text-ink">
          <span aria-hidden="true" className={`transition-transform ${open ? "rotate-90" : ""}`}>›</span>
        </button>
      </div>
      {tagState.error && <div className="px-5 pb-3"><Feedback {...tagState} /></div>}
      {open && (
        <div className="space-y-4 border-t border-line px-5 py-4">
          <p className="text-sm"><span className="text-muted">Te comparte:</span> {describeSharing(contact.receives)}</p>
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

function TagPresetEditor({ tag, value }: { tag: ContactTag; value: Sharing }) {
  const [state, submit, pending] = useActionState(saveTagPreset.bind(null, tag), {});
  const [share, setShare] = useState<Sharing>(value);
  const dirty = !sameSharing(share, value);
  return (
    <form action={submit} className="space-y-3 px-5 py-4">
      <p className="font-semibold">{contactTags[tag].label}</p>
      <SharingPicker value={share} onChange={setShare} />
      <div className="flex flex-wrap items-center gap-3">
        <button className={primaryButton} disabled={pending || !dirty}>{pending ? "Guardando…" : "Guardar"}</button>
        {dirty && <button type="button" className={button} onClick={() => setShare(value)}>Deshacer</button>}
        <Feedback {...(dirty ? {} : state)} />
      </div>
    </form>
  );
}

export function TagPresetsEditor({ presets }: { presets: TagPresets }) {
  const [open, setOpen] = useState(false);
  return (
    <section className={card}>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}
        className="flex w-full cursor-pointer items-center justify-between gap-4 px-5 py-4 text-left">
        <div>
          <h2 className="font-semibold">Qué comparte cada etiqueta</h2>
          <p className="text-sm text-muted">Al cambiarlo se actualizan los contactos con esa etiqueta, salvo los que personalizaste.</p>
        </div>
        <span aria-hidden="true" className={`text-xl text-muted transition-transform ${open ? "rotate-90" : ""}`}>›</span>
      </button>
      {open && (
        <div className="divide-y divide-line border-t border-line">
          {contactTagNames.map((tag) => <TagPresetEditor key={`${tag}:${presets[tag].join()}`} tag={tag} value={presets[tag]} />)}
        </div>
      )}
    </section>
  );
}
