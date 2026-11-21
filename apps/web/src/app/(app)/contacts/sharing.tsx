"use client";

import { useId } from "react";
import { categories, Category, type Sharing } from "@team-31/protocol";

const hints: Record<Category, string> = {
  availability: "Puede preguntar si estás libre y por tus horarios.",
  interests: "Puede preguntar si algo te interesa.",
  general: "Tu agente decide qué contesta a cualquier otra pregunta.",
};

function Switch({ category, checked, onChange }: {
  category: Category; checked: boolean; onChange: (value: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <div>
        <p id={id} className="text-[0.9375rem] font-medium">{categories[category].label}</p>
        <p className="text-xs text-muted">{hints[category]}</p>
      </div>
      <button type="button" role="switch" aria-checked={checked} aria-labelledby={id} onClick={() => onChange(!checked)}
        className={`relative h-7 w-12 shrink-0 cursor-pointer rounded-full transition ${checked ? "bg-accent" : "bg-line-strong"}`}>
        <span className={`absolute top-0.5 left-0.5 size-6 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-5" : ""}`} />
      </button>
      {checked && <input type="hidden" name="category" value={category} />}
    </div>
  );
}

export function SharingPicker({ value, onChange }: { value: Sharing; onChange: (value: Sharing) => void }) {
  return (
    <div className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-stage">
      {Category.options.map((category) => (
        <Switch key={category} category={category} checked={value.includes(category)}
          onChange={(checked) => onChange(checked ? [...value, category] : value.filter((item) => item !== category))} />
      ))}
    </div>
  );
}
