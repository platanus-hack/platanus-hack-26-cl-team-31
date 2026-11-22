"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { Tag } from "@team-31/protocol";
import { tagColors, type TagColor } from "@team-31/protocol/constants";

export const tagStyles: Record<TagColor, { badge: string; dot: string; active: string }> = {
  emerald: { badge: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300", dot: "bg-emerald-400/60", active: "bg-emerald-500/25 text-emerald-200" },
  amber: { badge: "border-amber-400/30 bg-amber-400/10 text-amber-300", dot: "bg-amber-400/60", active: "bg-amber-500/25 text-amber-200" },
  violet: { badge: "border-violet-400/30 bg-violet-400/10 text-violet-300", dot: "bg-violet-400/60", active: "bg-violet-500/25 text-violet-200" },
  sky: { badge: "border-sky-400/30 bg-sky-400/10 text-sky-300", dot: "bg-sky-400/60", active: "bg-sky-500/25 text-sky-200" },
  rose: { badge: "border-rose-400/30 bg-rose-400/10 text-rose-300", dot: "bg-rose-400/60", active: "bg-rose-500/25 text-rose-200" },
  slate: { badge: "border-slate-400/30 bg-slate-400/10 text-slate-300", dot: "bg-slate-400/60", active: "bg-slate-500/25 text-slate-200" },
};

const colorLabels: Record<TagColor, string> = {
  emerald: "Verde", amber: "Ámbar", violet: "Violeta", sky: "Celeste", rose: "Rosa", slate: "Gris",
};

const emptyBadge = "border-line bg-chip text-muted";

function toggle(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id];
}

export function TagPicker({ tags, value, onChange, name }: {
  tags: Tag[]; value: string[]; onChange: (ids: string[]) => void; name?: string;
}) {
  const label = useId();
  return (
    <div>
      <p id={label} className="sr-only">Etiquetas</p>
      <div role="group" aria-labelledby={label} className="flex flex-wrap gap-1 rounded-lg bg-stage p-1">
        {tags.map((tag) => {
          const active = value.includes(tag.id);
          return (
            <button key={tag.id} type="button" role="checkbox" aria-checked={active} onClick={() => onChange(toggle(value, tag.id))}
              className={`inline-flex min-h-9 cursor-pointer items-center justify-center gap-2 rounded-md px-3 text-sm font-medium transition ${active ? `${tagStyles[tag.color].active} shadow-sm` : "text-muted hover:text-ink"}`}>
              <span aria-hidden="true" className={`size-2 rounded-full ${tagStyles[tag.color].dot}`} />
              {tag.name}
            </button>
          );
        })}
      </div>
      {name && value.map((id) => <input key={id} type="hidden" name={name} value={id} />)}
    </div>
  );
}

export function TagBadge({ tag }: { tag?: Tag }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium ${tag ? tagStyles[tag.color].badge : emptyBadge}`}>
      {tag && <span aria-hidden="true" className={`size-1.5 rounded-full ${tagStyles[tag.color].dot}`} />}
      {tag ? tag.name : "Sin etiqueta"}
    </span>
  );
}

export function TagChips({ tags, value }: { tags: Tag[]; value: string[] }) {
  const chosen = tags.filter((tag) => value.includes(tag.id));
  if (!chosen.length) return <TagBadge />;
  return <>{chosen.map((tag) => <TagBadge key={tag.id} tag={tag} />)}</>;
}

export function TagMenu({ tags, value, custom, disabled, onChange }: {
  tags: Tag[];
  value: string[];
  custom?: boolean;
  disabled?: boolean;
  onChange: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const menu = useId();
  const chosen = tags.filter((tag) => value.includes(tag.id));

  useEffect(() => {
    if (!open) return;
    function onPointer(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={root} className="relative flex">
      <button type="button" disabled={disabled} aria-haspopup="menu" aria-expanded={open} aria-controls={menu}
        aria-label={`Etiquetas: ${chosen.map((tag) => tag.name).join(", ") || "sin etiqueta"}. Cambiar`}
        onClick={() => setOpen(!open)}
        className="inline-flex cursor-pointer flex-wrap items-center gap-1.5 transition hover:brightness-125 disabled:cursor-wait disabled:opacity-60">
        <TagChips tags={tags} value={value} />
        {custom && <span className="text-xs text-muted">· personalizado</span>}
        <svg aria-hidden="true" width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" className="text-muted"><path d="m2.5 4 2.5 2.5L7.5 4" /></svg>
      </button>
      {open && (
        <div id={menu} role="menu" className="raised absolute left-0 z-20 mt-1.5 w-56 origin-top-left animate-[pop_160ms_var(--ease-smooth-out)] rounded-lg border border-line bg-raised p-1 shadow-lg">
          {tags.map((tag) => {
            const active = value.includes(tag.id);
            return (
              <button key={tag.id} type="button" role="menuitemcheckbox" disabled={disabled} aria-checked={active} onClick={() => onChange(toggle(value, tag.id))}
                className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm text-ink transition hover:bg-chip-hover disabled:cursor-wait">
                <span aria-hidden="true" className={`size-2 rounded-full ${tagStyles[tag.color].dot}`} />
                <span className="flex-1">{tag.name}</span>
                {active && <span aria-hidden="true" className="text-muted">✓</span>}
              </button>
            );
          })}
          {custom && (
            <p className="border-t border-line px-2.5 pt-2 pb-1 text-xs text-muted">
              Personalizado. Al cambiar sus etiquetas vuelve a compartir lo que indican sus etiquetas.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export function ColorPicker({ value, onChange, name }: { value: TagColor; onChange: (color: TagColor) => void; name?: string }) {
  const label = useId();
  return (
    <div>
      <span id={label} className="sr-only">Color</span>
      <div role="radiogroup" aria-labelledby={label} className="flex items-center gap-1.5">
        {tagColors.map((color) => (
          <button key={color} type="button" role="radio" aria-checked={value === color} aria-label={colorLabels[color]}
            onClick={() => onChange(color)}
            className={`size-6 cursor-pointer rounded-full border-2 p-0.5 transition ${value === color ? "border-ink" : "border-transparent"}`}>
            <span aria-hidden="true" className={`block size-full rounded-full ${tagStyles[color].dot}`} />
          </button>
        ))}
      </div>
      {name && <input type="hidden" name={name} value={value} />}
    </div>
  );
}
