"use client";

import { startTransition, useActionState, useEffect, useState, useTransition } from "react";
import type { Contact, Invitation, Sharing, Tag } from "@team-31/protocol";
import { sameSharing, tagSharing } from "@team-31/protocol/constants";

import { answerInvitation, removeContact, saveContactTags, saveSharing, sendInvitation } from "./actions";
import { button, card, Feedback, Initial, input, primaryButton } from "../ui";
import { Modal, ModalCancel, useCloseModal } from "../modal";
import { useUndoWindow } from "../use-undo-window";
import { describeSharing } from "./describe";
import { SharingPicker } from "./sharing";
import { TagMenu, TagPicker } from "./tags";

const dangerButton = "inline-flex min-h-10 cursor-pointer items-center justify-center rounded-lg px-3.5 py-2 text-sm font-semibold text-danger transition hover:bg-danger-bg disabled:cursor-wait disabled:opacity-60";

function initialTags(tags: Tag[]): string[] {
  return tags.some((tag) => tag.id === "friend") ? ["friend"] : [];
}

function InviteForm({ tags }: { tags: Tag[] }) {
  const [state, submit, pending] = useActionState(sendInvitation, {});
  const [chosen, setChosen] = useState<string[]>(() => initialTags(tags));
  const close = useCloseModal();
  useEffect(() => { if (state.message) close(); }, [state, close]);
  return (
    <form action={submit} className="space-y-5">
      <div className="space-y-1.5">
        <label htmlFor="invite-to" className="text-[13px] font-medium text-body">Dirección Sideband</label>
        <input id="invite-to" name="to" required autoFocus placeholder="nombre@sideband.app" autoCapitalize="none" autoComplete="off"
          spellCheck={false} className={input} />
      </div>
      <div className="space-y-1.5">
        <p className="text-[13px] font-medium text-body">¿Qué es para ti?</p>
        <TagPicker tags={tags} value={chosen} onChange={setChosen} name="tag" />
        <p className="text-[13px] text-muted">Le compartirás: <span className="text-ink">{describeSharing(tagSharing(tags, chosen))}</span></p>
      </div>
      <Feedback error={state.error} errorId={state.errorId} />
      <div className="flex justify-end gap-2 pt-1">
        <ModalCancel />
        <button className={primaryButton} disabled={pending}>{pending ? "Enviando…" : "Enviar invitación"}</button>
      </div>
    </form>
  );
}

export function InviteButton({ tags }: { tags: Tag[] }) {
  return (
    <Modal label="Invitar" title="Invitar a alguien" description="Elige sus etiquetas. Si acepta, quedan conectados y esa persona elige qué te comparte.">
      <InviteForm tags={tags} />
    </Modal>
  );
}

export function IncomingInvitation({ invitation, tags }: { invitation: Invitation; tags: Tag[] }) {
  const [state, submit, pending] = useActionState(answerInvitation.bind(null, invitation.requestId), {});
  const [chosen, setChosen] = useState<string[]>(() => initialTags(tags));
  const { scheduled, schedule, undo } = useUndoWindow(() => {
    const form = new FormData();
    form.set("answer", "decline");
    startTransition(() => submit(form));
  });
  const gone = pending || state.message;

  if (scheduled) {
    return (
      <li className="flex items-center justify-between gap-3 px-4 py-3 text-[13px] text-muted">
        <span>Solicitud de {invitation.address} rechazada.</span>
        <button type="button" onClick={undo} className="cursor-pointer font-medium text-accent-ink hover:underline">Deshacer</button>
      </li>
    );
  }

  return (
    <li className={`flex flex-wrap items-center gap-3 px-4 py-3 ${gone ? "hidden" : ""}`}>
      <Initial name={invitation.address} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-ink">{invitation.address}</p>
        <p className="truncate text-xs text-muted">Te comparte: {describeSharing(invitation.offer)}</p>
      </div>
      <TagMenu tags={tags} value={chosen} onChange={setChosen} />
      <form action={submit} className="flex items-center gap-2">
        {chosen.map((id) => <input key={id} type="hidden" name="tag" value={id} />)}
        <button type="button" onClick={schedule} disabled={pending} className={button}>Rechazar</button>
        <button className={primaryButton} name="answer" value="accept" disabled={pending}>Aceptar</button>
      </form>
      {state.error && <div className="basis-full"><Feedback {...state} /></div>}
    </li>
  );
}

export function ContactRow({ contact, tags }: { contact: Contact; tags: Tag[] }) {
  const [tagging, startTagging] = useTransition();
  const [tagState, setTagState] = useState<{ error?: string }>({});
  const custom = contact.tags.length > 0 && !sameSharing(contact.gives, tagSharing(tags, contact.tags));
  function retag(ids: string[]) {
    startTagging(async () => setTagState(await saveContactTags(contact.address, ids)));
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
      <div className="flex items-center gap-3 px-4 py-3">
        <Initial name={contact.displayName || contact.address} />
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <p className="break-all text-sm font-medium text-ink">{contact.address}</p>
          <TagMenu tags={tags} value={contact.tags} custom={custom} disabled={tagging} onChange={retag} />
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

