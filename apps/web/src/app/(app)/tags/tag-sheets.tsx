"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import type { Sharing, Tag } from "@team-31/protocol";
import type { TagColor } from "@team-31/protocol/constants";

import { createTag, deleteTag, saveTag } from "../contacts/actions";
import { describeSharing } from "../contacts/describe";
import { SharingPicker } from "../contacts/sharing";
import { ColorPicker, tagStyles } from "../contacts/tags";
import { Modal, ModalCancel, useCloseModal } from "../modal";
import { Feedback, input, primaryButton } from "../ui";

type Member = Tag & { members: string[] };

function TagSheet({ tag, onDelete }: { tag: Member; onDelete: () => void }) {
  const close = useCloseModal();
  const [name, setName] = useState(tag.name);
  const [color, setColor] = useState<TagColor>(tag.color);
  const [share, setShare] = useState<Sharing>(tag.categories);
  const [state, setState] = useState<{ error?: string; errorId?: string }>({});
  const [, start] = useTransition();

  function save(next: { name?: string; color?: TagColor; share?: Sharing }) {
    const form = new FormData();
    form.set("name", (next.name ?? name).trim() || tag.name);
    form.set("color", next.color ?? color);
    for (const category of next.share ?? share) form.append("category", category);
    start(async () => setState(await saveTag(tag.id, {}, form)));
  }

  const count = tag.members.length;
  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <label htmlFor={`tag-name-${tag.id}`} className="sr-only">Nombre de la etiqueta</label>
        <input id={`tag-name-${tag.id}`} value={name} maxLength={80} onChange={(event) => setName(event.target.value)}
          onBlur={() => { if (name.trim() && name.trim() !== tag.name) save({ name }); }}
          onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
          className={input} />
        <ColorPicker value={color} onChange={(next) => { setColor(next); save({ color: next }); }} />
      </div>
      <div className="space-y-2">
        <p className="text-[13px] font-medium text-body">Comparte</p>
        <SharingPicker value={share} onChange={(next) => { setShare(next); save({ share: next }); }} />
        <p className="text-xs text-muted">
          Se aplica al tiro a {count === 1 ? "su contacto" : `sus ${count} contactos`}, salvo los personalizados.
        </p>
      </div>
      <Feedback {...state} />
      <div className="flex items-center justify-between border-t border-line pt-4">
        <button type="button" onClick={() => { close(); onDelete(); }}
          className="cursor-pointer text-[13px] font-medium text-danger hover:underline">Eliminar etiqueta</button>
        <button type="button" onClick={close} className={primaryButton}>Listo</button>
      </div>
    </div>
  );
}

export function TagRow({ tag }: { tag: Member }) {
  const [deleting, setDeleting] = useState(false);
  const [state, remove, pending] = useActionState(deleteTag.bind(null, tag.id), {});
  const [, start] = useTransition();
  useEffect(() => {
    if (!deleting) return;
    const timer = setTimeout(() => start(remove), 5000);
    return () => clearTimeout(timer);
  }, [deleting, remove]);

  if (deleting && !state.error) {
    return (
      <li className="flex items-center justify-between gap-3 px-4 py-3 text-[13px] text-muted">
        <span>Etiqueta {tag.name} eliminada.</span>
        {!pending && <button type="button" onClick={() => setDeleting(false)} className="cursor-pointer font-medium text-accent-ink hover:underline">Deshacer</button>}
      </li>
    );
  }

  const count = tag.members.length;
  return (
    <li>
      <Modal label={`Editar ${tag.name}`} title={tag.name}
        triggerClassName="flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-white/3"
        trigger={<>
          <span aria-hidden="true" className={`size-2.5 shrink-0 rounded-full ${tagStyles[tag.color].dot}`} />
          <span className="w-32 shrink-0 truncate text-sm font-medium text-ink">{tag.name}</span>
          <span className="min-w-0 flex-1 truncate text-[13px] text-muted">{tag.categories.length ? describeSharing(tag.categories) : "No comparte nada"}</span>
          <span className="shrink-0 text-xs text-muted tabular-nums">{count === 1 ? "1 contacto" : `${count} contactos`}</span>
          <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-muted"><path d="m4.5 2.5 3.5 3.5-3.5 3.5" /></svg>
        </>}>
        <TagSheet tag={tag} onDelete={() => setDeleting(true)} />
      </Modal>
      {state.error && <div className="px-4 pb-3"><Feedback {...state} /></div>}
    </li>
  );
}

function NewTagForm() {
  const [state, submit, pending] = useActionState(createTag, {});
  const [color, setColor] = useState<TagColor>("sky");
  const close = useCloseModal();
  useEffect(() => { if (state.message) close(); }, [state, close]);
  return (
    <form action={submit} className="space-y-5">
      <div className="space-y-3">
        <label htmlFor="new-tag" className="text-[13px] font-medium text-body">Nombre</label>
        <input id="new-tag" name="name" required autoFocus maxLength={80} placeholder="Fútbol del jueves" className={input} />
        <ColorPicker value={color} onChange={setColor} name="color" />
      </div>
      <Feedback error={state.error} errorId={state.errorId} />
      <div className="flex justify-end gap-2 pt-1">
        <ModalCancel />
        <button className={primaryButton} disabled={pending}>{pending ? "Creando…" : "Crear etiqueta"}</button>
      </div>
    </form>
  );
}

export function NewTag() {
  return (
    <Modal label="Nueva etiqueta" title="Nueva etiqueta" description="Después eliges qué comparte y a qué contactos se la pones.">
      <NewTagForm />
    </Modal>
  );
}
