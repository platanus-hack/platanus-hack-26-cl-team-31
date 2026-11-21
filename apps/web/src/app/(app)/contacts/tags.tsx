"use client";

import { useId } from "react";
import { ContactTag, contactTags } from "@team-31/protocol";

export function TagPicker({ value, onChange, name }: { value?: ContactTag; onChange: (tag: ContactTag) => void; name?: string }) {
  const label = useId();
  return (
    <div>
      <p id={label} className="sr-only">Etiqueta</p>
      <div role="radiogroup" aria-labelledby={label} className="grid grid-cols-3 gap-1 rounded-lg bg-stage p-1">
        {ContactTag.options.map((tag) => {
          const active = value === tag;
          return (
            <button key={tag} type="button" role="radio" aria-checked={active} onClick={() => onChange(tag)}
              className={`min-h-9 cursor-pointer rounded-md px-2 text-sm font-medium transition ${active ? "bg-accent text-white shadow-sm" : "text-muted hover:text-ink"}`}>
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
    <span className="inline-block rounded-full border border-line px-2 py-0.5 text-xs font-medium text-muted">
      {tag ? contactTags[tag].label : "Sin etiqueta"}
    </span>
  );
}
