"use client";

import { useEffect, useId, useRef, useState } from "react";
import { contactTagNames, contactTags, type ContactTag } from "@team-31/protocol/constants";

const tagStyles: Record<ContactTag, { badge: string; dot: string; active: string }> = {
  friend: { badge: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300", dot: "bg-emerald-400", active: "bg-emerald-500/25 text-emerald-200" },
  family: { badge: "border-amber-400/30 bg-amber-400/10 text-amber-300", dot: "bg-amber-400", active: "bg-amber-500/25 text-amber-200" },
  work: { badge: "border-violet-400/30 bg-violet-400/10 text-violet-300", dot: "bg-violet-400", active: "bg-violet-500/25 text-violet-200" },
};

const emptyBadge = "border-line bg-chip text-muted";

export function TagPicker({ value, onChange, name }: { value?: ContactTag; onChange: (tag: ContactTag) => void; name?: string }) {
  const label = useId();
  return (
    <div>
      <p id={label} className="sr-only">Etiqueta</p>
      <div role="radiogroup" aria-labelledby={label} className="grid grid-cols-3 gap-1 rounded-lg bg-stage p-1">
        {contactTagNames.map((tag) => {
          const active = value === tag;
          return (
            <button key={tag} type="button" role="radio" aria-checked={active} onClick={() => onChange(tag)}
              className={`inline-flex min-h-9 cursor-pointer items-center justify-center gap-2 rounded-md px-2 text-sm font-medium transition ${active ? `${tagStyles[tag].active} shadow-sm` : "text-muted hover:text-ink"}`}>
              <span aria-hidden="true" className={`size-2 rounded-full ${tagStyles[tag].dot}`} />
              {contactTags[tag].label}
            </button>
          );
        })}
      </div>
      {name && value && <input type="hidden" name={name} value={value} />}
    </div>
  );
}

export function TagBadge({ tag }: { tag?: ContactTag }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium ${tag ? tagStyles[tag].badge : emptyBadge}`}>
      {tag && <span aria-hidden="true" className={`size-1.5 rounded-full ${tagStyles[tag].dot}`} />}
      {tag ? contactTags[tag].label : "Sin etiqueta"}
    </span>
  );
}

export function TagMenu({ value, custom, disabled, onChange }: {
  value?: ContactTag;
  custom?: boolean;
  disabled?: boolean;
  onChange: (tag: ContactTag) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const menu = useId();

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

  function pick(tag: ContactTag) {
    setOpen(false);
    onChange(tag);
  }

  return (
    <div ref={root} className="relative">
      <button type="button" disabled={disabled} aria-haspopup="menu" aria-expanded={open} aria-controls={menu}
        aria-label={`Etiqueta: ${value ? contactTags[value].label : "sin etiqueta"}. Cambiar`}
        onClick={() => setOpen(!open)}
        className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium transition hover:brightness-125 disabled:cursor-wait disabled:opacity-60 ${value ? tagStyles[value].badge : emptyBadge}`}>
        {value && <span aria-hidden="true" className={`size-1.5 rounded-full ${tagStyles[value].dot}`} />}
        {value ? contactTags[value].label : "Sin etiqueta"}
        {custom && <span className="opacity-70">· personalizado</span>}
        <span aria-hidden="true" className="opacity-70">▾</span>
      </button>
      {open && (
        <div id={menu} role="menu" className="raised absolute left-0 z-20 mt-1.5 w-52 rounded-lg border border-line bg-raised p-1 shadow-lg">
          {contactTagNames.map((tag) => {
            const active = tag === value;
            return (
              <button key={tag} type="button" role="menuitemradio" aria-checked={active && !custom} onClick={() => pick(tag)}
                className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm text-ink transition hover:bg-chip-hover">
                <span aria-hidden="true" className={`size-2 rounded-full ${tagStyles[tag].dot}`} />
                <span className="flex-1">{contactTags[tag].label}</span>
                {active && <span aria-hidden="true" className="text-muted">{custom ? "·" : "✓"}</span>}
              </button>
            );
          })}
          {custom && value && (
            <p className="border-t border-line px-2.5 pt-2 pb-1 text-xs text-muted">
              Personalizado. Elige {contactTags[value].label} para volver a su preset.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
