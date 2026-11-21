"use client";

import { useId } from "react";
import type { Sharing } from "@team-31/protocol";

const availabilityOptions = [
  { value: "none", label: "No" },
  { value: "busy", label: "Si estoy libre" },
  { value: "slots", label: "Con mis horarios" },
] as const;

function Switch({ name, label, hint, checked, onChange }: {
  name: string; label: string; hint: string; checked: boolean; onChange: (value: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <div>
        <p id={id} className="text-[0.9375rem] font-medium">{label}</p>
        <p className="text-xs text-[#525e50]">{hint}</p>
      </div>
      <button type="button" role="switch" aria-checked={checked} aria-labelledby={id} onClick={() => onChange(!checked)}
        className={`relative h-7 w-12 shrink-0 cursor-pointer rounded-full transition ${checked ? "bg-[#28513b]" : "bg-[#d5dacd]"}`}>
        <span className={`absolute top-0.5 left-0.5 size-6 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-5" : ""}`} />
      </button>
      {checked && <input type="hidden" name={name} value="on" />}
    </div>
  );
}

export function SharingPicker({ value, onChange }: { value: Sharing; onChange: (value: Sharing) => void }) {
  const legend = useId();
  return (
    <div className="divide-y divide-[#e6e9df] overflow-hidden rounded-xl border border-[#dfe3d7] bg-[#fcfcf7]">
      <div className="space-y-2 px-4 py-3">
        <p id={legend} className="text-[0.9375rem] font-medium">Disponibilidad</p>
        <div role="radiogroup" aria-labelledby={legend} className="grid grid-cols-3 gap-1 rounded-lg bg-[#eceee6] p-1">
          {availabilityOptions.map((option) => {
            const active = value.availability === option.value;
            return (
              <button key={option.value} type="button" role="radio" aria-checked={active}
                onClick={() => onChange({ ...value, availability: option.value })}
                className={`min-h-9 cursor-pointer rounded-md px-1.5 text-[0.8125rem] leading-tight font-medium transition sm:text-sm ${active ? "bg-white text-[#20261d] shadow-sm" : "text-[#525e50] hover:text-[#20261d]"}`}>
                {option.label}
              </button>
            );
          })}
        </div>
        <input type="hidden" name="availability" value={value.availability} />
      </div>
      <Switch name="interests" label="Intereses" hint="Puede preguntar si algo te interesa."
        checked={value.interests} onChange={(interests) => onChange({ ...value, interests })} />
      <Switch name="questions" label="Preguntas abiertas" hint="Tu agente decide qué contesta a cualquier pregunta."
        checked={value.questions} onChange={(questions) => onChange({ ...value, questions })} />
    </div>
  );
}
