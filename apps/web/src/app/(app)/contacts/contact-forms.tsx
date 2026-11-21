"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import type { Contact, Invitation, Sharing, Tag } from "@team-31/protocol";
import { sameSharing, tagSharing, type TagColor } from "@team-31/protocol/constants";

import { answerInvitation, createTag, deleteTag, removeContact, saveContactTags, saveSharing, saveTag, sendInvitation } from "./actions";
import { button, card, Feedback, input, primaryButton } from "../ui";
import { Modal, ModalCancel, useCloseModal } from "../modal";
import { describeSharing } from "./describe";
import { SharingPicker } from "./sharing";
import { ColorPicker, TagMenu, TagPicker } from "./tags";

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
  return (
    <li className={`${card} space-y-4 p-5`}>
      <div>
        <h3 className="break-all font-semibold">{invitation.address}</h3>
        <p className="text-sm text-muted">Quiere conectar contigo.</p>
      </div>
      <p className="text-sm"><span className="text-muted">Te compartirá:</span> <span className="font-medium">{describeSharing(invitation.offer)}</span></p>
      <form action={submit} className="space-y-3">
        <p className="text-sm font-semibold">¿Qué es para ti?</p>
        <TagPicker tags={tags} value={chosen} onChange={setChosen} name="tag" />
        <p className="text-sm"><span className="text-muted">Le compartirás:</span> <span className="font-medium">{describeSharing(tagSharing(tags, chosen))}</span></p>
        <div className="flex flex-wrap gap-2">
          <button className={primaryButton} name="answer" value="accept" disabled={pending}>Aceptar</button>
          <button className={button} name="answer" value="decline" disabled={pending}>Rechazar</button>
        </div>
        <Feedback {...state} />
      </form>
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
      <div className="flex items-center gap-3 px-5 py-4">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <p className="break-all font-semibold">{contact.address}</p>
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

function TagEditor({ tag }: { tag: Tag }) {
  const [state, submit, pending] = useActionState(saveTag.bind(null, tag.id), {});
  const [removeState, remove, removing] = useActionState(deleteTag.bind(null, tag.id), {});
  const [name, setName] = useState(tag.name);
  const [color, setColor] = useState<TagColor>(tag.color);
  const [share, setShare] = useState<Sharing>(tag.categories);
  const [confirming, setConfirming] = useState(false);
  const dirty = name.trim() !== tag.name || color !== tag.color || !sameSharing(share, tag.categories);
  function reset() {
    setName(tag.name);
    setColor(tag.color);
    setShare(tag.categories);
  }
  return (
    <div className="space-y-3 px-5 py-4">
      <form action={submit} className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <label htmlFor={`tag-${tag.id}`} className="sr-only">Nombre de la etiqueta</label>
          <input id={`tag-${tag.id}`} name="name" required maxLength={80} value={name} onChange={(event) => setName(event.target.value)}
            className={`${input} min-w-40 flex-1 font-semibold`} />
          <ColorPicker value={color} onChange={setColor} name="color" />
        </div>
        <SharingPicker value={share} onChange={setShare} />
        <div className="flex flex-wrap items-center gap-3">
          <button className={primaryButton} disabled={pending || !dirty}>{pending ? "Guardando…" : "Guardar"}</button>
          {dirty && <button type="button" className={button} onClick={reset}>Deshacer</button>}
          <Feedback {...(dirty ? {} : state)} />
        </div>
      </form>
      <form action={remove} className="flex flex-wrap items-center gap-2">
        {confirming ? (
          <>
            <p className="text-sm text-muted">Se quitará de tus contactos y de la bóveda.</p>
            <button className={dangerButton} disabled={removing}>Sí, borrar etiqueta</button>
            <button type="button" className={button} onClick={() => setConfirming(false)}>Cancelar</button>
          </>
        ) : (
          <button type="button" className={dangerButton} onClick={() => setConfirming(true)}>Borrar etiqueta</button>
        )}
        <Feedback {...removeState} />
      </form>
    </div>
  );
}

function CreateTagForm() {
  const [state, submit, pending] = useActionState(createTag, {});
  const [color, setColor] = useState<TagColor>("sky");
  return (
    <form action={submit} className="space-y-3 px-5 py-4">
      <p className="font-semibold">Nueva etiqueta</p>
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor="new-tag" className="sr-only">Nombre de la etiqueta</label>
        <input id="new-tag" name="name" required maxLength={80} placeholder="Nombre" className={`${input} min-w-40 flex-1`} />
        <ColorPicker value={color} onChange={setColor} name="color" />
        <button className={primaryButton} disabled={pending}>{pending ? "Creando…" : "Crear"}</button>
      </div>
      <Feedback {...state} />
    </form>
  );
}

export function TagsEditor({ tags }: { tags: Tag[] }) {
  const [open, setOpen] = useState(false);
  return (
    <section className={card}>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}
        className="flex w-full cursor-pointer items-center justify-between gap-4 px-5 py-4 text-left">
        <div>
          <h2 className="font-semibold">Qué comparte cada etiqueta</h2>
          <p className="text-sm text-muted">Un contacto comparte lo de todas sus etiquetas. Al cambiar una se actualizan sus contactos, salvo los que personalizaste.</p>
        </div>
        <span aria-hidden="true" className={`text-xl text-muted transition-transform ${open ? "rotate-90" : ""}`}>›</span>
      </button>
      {open && (
        <div className="divide-y divide-line border-t border-line">
          {tags.map((tag) => <TagEditor key={`${tag.id}:${tag.name}:${tag.color}:${tag.categories.join()}`} tag={tag} />)}
          <CreateTagForm />
        </div>
      )}
    </section>
  );
}
