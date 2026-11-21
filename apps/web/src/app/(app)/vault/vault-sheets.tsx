"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import type { OwnerVault, Tag } from "@team-31/protocol";

import { tagStyles } from "../contacts/tags";
import { Modal, ModalCancel, useCloseModal } from "../modal";
import { Feedback, Initial, input, primaryButton } from "../ui";
import { changeVault } from "./actions";

type Category = OwnerVault["categories"][number];
type Result = { error?: string; message?: string; errorId?: string };

function useVault() {
  const [state, setState] = useState<Result>({});
  const [pending, start] = useTransition();
  const run = useCallback((fields: Record<string, string>, after?: (result: Result) => void) => {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) form.set(key, value);
    start(async () => {
      const result = await changeVault(form);
      setState(result);
      after?.(result);
    });
  }, []);
  return { state, pending, run };
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <p className="text-[13px] font-medium text-body">{title}</p>
      {children}
    </div>
  );
}

function CategorySheet({ category, tags, onDelete }: { category: Category; tags: Tag[]; onDelete: () => void }) {
  const close = useCloseModal();
  const { state, pending, run } = useVault();
  const [name, setName] = useState(category.name);
  const [description, setDescription] = useState(category.description ?? "");
  const [allowed, setAllowed] = useState<string[]>(category.tags);
  const [isPublic, setIsPublic] = useState(category.visibility === "public");
  const [entries, setEntries] = useState(category.entries);
  const [label, setLabel] = useState("");
  const [value, setValue] = useState("");
  const base = { categoryId: category.id };

  function toggle(tag: Tag) {
    const on = !allowed.includes(tag.id);
    setAllowed(on ? [...allowed, tag.id] : allowed.filter((id) => id !== tag.id));
    run({ ...base, action: "set_tag", tagId: tag.id, allowed: String(on) });
  }

  function togglePublic() {
    setIsPublic(!isPublic);
    run({ ...base, action: "set_visibility", visibility: isPublic ? "private" : "public" });
  }

  function add(event: React.FormEvent) {
    event.preventDefault();
    if (!label.trim() || !value.trim()) return;
    const entry = { label: label.trim(), value: value.trim() };
    setEntries([...entries.filter((item) => item.label !== entry.label), entry]);
    setLabel("");
    setValue("");
    run({ ...base, action: "put_entry", kind: "auto", ...entry });
  }

  function remove(entryLabel: string) {
    setEntries(entries.filter((item) => item.label !== entryLabel));
    run({ ...base, action: "delete_entry", label: entryLabel });
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <label htmlFor={`vault-name-${category.id}`} className="sr-only">Nombre de la categoría</label>
        <input id={`vault-name-${category.id}`} value={name} maxLength={80} onChange={(event) => setName(event.target.value)}
          onBlur={() => { if (name.trim() && name.trim() !== category.name) run({ ...base, action: "rename", name: name.trim() }); }}
          onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
          className={input} />
        <label htmlFor={`vault-description-${category.id}`} className="sr-only">Descripción de la categoría</label>
        <input id={`vault-description-${category.id}`} value={description} maxLength={280} placeholder="De qué trata esta categoría"
          onChange={(event) => setDescription(event.target.value)}
          onBlur={() => { if (description.trim() !== (category.description ?? "")) run({ ...base, action: "describe", description: description.trim() }); }}
          onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
          className={input} />
      </div>

      <Section title="Datos">
        <ul className="divide-y divide-line overflow-hidden rounded-xl bg-stage">
          {entries.map((entry) => (
            <li key={entry.label} className="group flex items-center gap-3 px-3.5 py-2.5 text-sm">
              <span className="w-28 shrink-0 truncate text-muted">{entry.label}</span>
              <span className="min-w-0 flex-1 text-ink [overflow-wrap:anywhere]">{String(entry.value)}</span>
              <button type="button" aria-label={`Quitar ${entry.label}`} onClick={() => remove(entry.label)}
                className="grid size-6 shrink-0 cursor-pointer place-items-center rounded-md text-muted opacity-0 transition hover:bg-white/8 hover:text-ink focus-visible:opacity-100 group-hover:opacity-100">
                <svg aria-hidden="true" width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><path d="m2 2 6 6M8 2 2 8" /></svg>
              </button>
            </li>
          ))}
          <li>
            <form onSubmit={add} className="flex items-center gap-2 px-2 py-2">
              <input value={label} onChange={(event) => setLabel(event.target.value)} maxLength={80} placeholder="Nombre" aria-label="Nombre del dato"
                className="h-8 w-28 shrink-0 rounded-lg bg-transparent px-1.5 text-sm text-ink placeholder:text-subtle focus-visible:bg-white/4 focus-visible:outline-none" />
              <input value={value} onChange={(event) => setValue(event.target.value)} maxLength={2000} placeholder="Agregar un dato…" aria-label="Valor del dato"
                className="h-8 min-w-0 flex-1 rounded-lg bg-transparent px-1.5 text-sm text-ink placeholder:text-subtle focus-visible:bg-white/4 focus-visible:outline-none" />
              <button className="h-7 shrink-0 cursor-pointer rounded-full px-2.5 text-[13px] font-medium text-accent-ink transition hover:bg-accent-soft disabled:opacity-40"
                disabled={!label.trim() || !value.trim()}>Agregar</button>
            </form>
          </li>
        </ul>
        <p className="text-xs text-muted">Si usas un nombre que ya existe, se reemplaza su valor.</p>
      </Section>

      <Section title="Quién puede leer">
        <button type="button" role="switch" aria-checked={isPublic} onClick={togglePublic}
          className="flex w-full cursor-pointer items-center justify-between gap-4 rounded-xl bg-stage px-3.5 py-2.5 text-left">
          <span>
            <span className="block text-sm font-medium text-ink">Pública</span>
            <span className="block text-xs text-muted">Cualquier usuario de Sideband puede leerla.</span>
          </span>
          <span aria-hidden="true" className={`relative h-7 w-12 shrink-0 rounded-full transition ${isPublic ? "bg-accent" : "bg-line-strong"}`}>
            <span className={`absolute top-0.5 left-0.5 size-6 rounded-full bg-white shadow transition-transform ${isPublic ? "translate-x-5" : ""}`} />
          </span>
        </button>
        <div className="flex flex-wrap gap-2">
          {tags.map((tag) => {
            const on = allowed.includes(tag.id);
            return (
              <button key={tag.id} type="button" role="switch" aria-checked={on} onClick={() => toggle(tag)}
                className={`inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full px-3 text-[13px] font-medium transition-colors ${on ? `${tagStyles[tag.color].badge} border` : "bg-white/4 text-muted hover:text-ink"}`}>
                <span aria-hidden="true" className={`size-1.5 rounded-full ${tagStyles[tag.color].dot}`} />
                {tag.name}
                {on && <svg aria-hidden="true" width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="m2 5.2 2 2L8 3" /></svg>}
              </button>
            );
          })}
        </div>
        {isPublic ? null : category.members?.length ? (
          <div className="flex items-center gap-2 pt-1">
            <div className="flex -space-x-2">{category.members.slice(0, 5).map((address) => <span key={address} className="rounded-full ring-2 ring-menu"><Initial name={address} /></span>)}</div>
            <p className="text-xs text-muted">{category.members.length === 1 ? `${category.members[0]} puede leerla` : `${category.members.length} personas pueden leerla`}</p>
          </div>
        ) : <p className="text-xs text-muted">{allowed.length ? "Ningún contacto tiene esas etiquetas todavía." : "Solo tú. Hazla pública o elige etiquetas para compartirla."}</p>}
      </Section>

      <Feedback error={state.error} errorId={state.errorId} />
      <div className="flex items-center justify-between border-t border-line pt-4">
        <button type="button" onClick={() => { close(); onDelete(); }} className="cursor-pointer text-[13px] font-medium text-danger hover:underline">Eliminar categoría</button>
        <button type="button" onClick={close} className={primaryButton} disabled={pending}>{pending ? "Guardando…" : "Listo"}</button>
      </div>
    </div>
  );
}

export function CategoryRow({ category, tags }: { category: Category; tags: Tag[] }) {
  const { state, pending, run } = useVault();
  const [deleting, setDeleting] = useState(false);
  useEffect(() => {
    if (!deleting || pending) return;
    const timer = setTimeout(() => run({ action: "delete", categoryId: category.id }), 5000);
    return () => clearTimeout(timer);
  }, [deleting, pending, category.id, run]);

  if (deleting && !state.error) {
    return (
      <li className="flex items-center justify-between gap-3 px-4 py-3 text-[13px] text-muted">
        <span>Eliminaste «{category.name}» con sus datos.</span>
        {!pending && <button type="button" onClick={() => setDeleting(false)} className="cursor-pointer font-medium text-accent-ink hover:underline">Deshacer</button>}
      </li>
    );
  }

  const shared = tags.filter((tag) => category.tags.includes(tag.id));
  const count = category.entries.length;
  const open = category.visibility === "public" || shared.length > 0;
  return (
    <li>
      <Modal label={`Abrir ${category.name}`} title={category.name} wide
        triggerClassName="flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-white/3"
        trigger={<>
          <span aria-hidden="true" className={`grid size-9 shrink-0 place-items-center rounded-full ${open ? "bg-accent-soft text-accent-ink" : "bg-white/6 text-muted"}`}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
              {open ? <><circle cx="6" cy="6" r="2.2" /><circle cx="11" cy="7" r="1.8" /><path d="M2 13c.6-2 2.1-3 4-3s3.4 1 4 3M10 10.2c1.6 0 2.8.9 3.4 2.6" /></> : <><rect x="3" y="7" width="10" height="7" rx="2" /><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" /></>}
            </svg>
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-ink">{category.name}</span>
            {category.description && <span className="block truncate text-xs text-body">{category.description}</span>}
            <span className="block truncate text-xs text-muted">
              {count === 0 ? "Sin datos" : count === 1 ? "1 dato" : `${count} datos`} · {category.visibility === "public" ? "Pública" : shared.length ? `Compartida con ${shared.map((tag) => tag.name).join(", ")}` : "Privada"}
            </span>
          </span>
          <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-muted"><path d="m4.5 2.5 3.5 3.5-3.5 3.5" /></svg>
        </>}>
        <CategorySheet category={category} tags={tags} onDelete={() => setDeleting(true)} />
      </Modal>
      {state.error && <div className="px-4 pb-3"><Feedback {...state} /></div>}
    </li>
  );
}

function NewCategoryForm() {
  const close = useCloseModal();
  const { state, pending, run } = useVault();
  const [name, setName] = useState("");
  return (
    <form onSubmit={(event) => { event.preventDefault(); run({ action: "create", name }, (result) => { if (!result.error) close(); }); }} className="space-y-5">
      <label className="block space-y-1.5">
        <span className="text-[13px] font-medium text-body">Nombre</span>
        <input value={name} onChange={(event) => setName(event.target.value)} required autoFocus maxLength={80} placeholder="Lista de regalos" className={input} />
      </label>
      <Feedback error={state.error} errorId={state.errorId} />
      <div className="flex justify-end gap-2 pt-1">
        <ModalCancel />
        <button className={primaryButton} disabled={pending || !name.trim()}>{pending ? "Creando…" : "Crear categoría"}</button>
      </div>
    </form>
  );
}

export function NewCategory() {
  return (
    <Modal label="Nueva categoría" title="Nueva categoría" description="Empieza privada. Después agregas datos y eliges quién puede leerla.">
      <NewCategoryForm />
    </Modal>
  );
}
