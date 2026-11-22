"use client";

import { startTransition, useActionState, useEffect, useState, useTransition } from "react";
import type { Sharing, Tag } from "@team-31/protocol";
import { sameSharing, type TagColor } from "@team-31/protocol/constants";

import { createTag, deleteTag, saveTag } from "../contacts/actions";
import { describeSharing } from "../contacts/describe";
import { SharingPicker } from "../contacts/sharing";
import { ColorPicker, tagStyles } from "../contacts/tags";
import { Modal, ModalCancel, useCloseModal } from "../modal";
import { Feedback, input, primaryButton } from "../ui";
import { useUndoWindow } from "../use-undo-window";

type Member = Tag & { members: string[] };

function TagSheet({ tag, onDelete }: { tag: Member; onDelete: () => void }) {
  const close = useCloseModal();
  const [name, setName] = useState(tag.name);
  const [color, setColor] = useState<TagColor>(tag.color);
  const [share, setShare] = useState<Sharing>(tag.categories);
  const [state, setState] = useState<{ error?: string; errorId?: string }>({});
  const [pending, start] = useTransition();
  const dirty = name.trim() !== tag.name || color !== tag.color || !sameSharing(share, tag.categories);

  function save() {
    const form = new FormData();
    form.set("name", name.trim() || tag.name);
    form.set("color", color);
    for (const category of share) form.append("category", category);
    start(async () => {
      const result = await saveTag(tag.id, {}, form);
      setState(result);
      if (!result.error) close();
    });
  }

  const count = tag.members.length;
  return (
    <form onSubmit={(event) => { event.preventDefault(); save(); }} className="space-y-6">
      <div className="space-y-3">
        <label htmlFor={`tag-name-${tag.id}`} className="sr-only">Nombre de la etiqueta</label>
        <input id={`tag-name-${tag.id}`} value={name} maxLength={80} required onChange={(event) => setName(event.target.value)} className={input} />
        <ColorPicker value={color} onChange={setColor} />
      </div>
      <div className="space-y-2">
        <p className="text-[13px] font-medium text-body">Comparte</p>
        <SharingPicker value={share} onChange={setShare} />
        <p className="text-xs text-muted">
          Al guardar se aplica a {count === 1 ? "su contacto" : `sus ${count} contactos`}, salvo los personalizados.
        </p>
      </div>
      <Feedback {...state} />
      <div className="flex items-center justify-between gap-3 border-t border-line pt-4">
        <button type="button" onClick={() => { close(); onDelete(); }}
          className="cursor-pointer text-[13px] font-medium text-danger hover:underline">Eliminar etiqueta</button>
        <div className="flex gap-2">
          <ModalCancel />
          <button className={primaryButton} disabled={pending || !dirty || !name.trim()}>{pending ? "Guardando…" : "Guardar"}</button>
        </div>
      </div>
    </form>
  );
}

export function TagRow({ tag }: { tag: Member }) {
  const [state, remove, pending] = useActionState(deleteTag.bind(null, tag.id), null);
  const { scheduled, schedule, undo } = useUndoWindow(() => startTransition(remove));

  if (scheduled || pending || (state && !state.error)) {
    return (
      <li className="flex items-center justify-between gap-3 px-4 py-3 text-[13px] text-muted">
        <span>Etiqueta {tag.name} eliminada.</span>
        {scheduled && <button type="button" onClick={undo} className="cursor-pointer font-medium text-accent-ink hover:underline">Deshacer</button>}
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
        <TagSheet tag={tag} onDelete={schedule} />
      </Modal>
      {state?.error && <div className="px-4 pb-3"><Feedback {...state} /></div>}
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
