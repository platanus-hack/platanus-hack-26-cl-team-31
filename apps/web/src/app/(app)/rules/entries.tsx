"use client";

import { useId, useState, type ReactNode } from "react";
import { Address } from "@team-31/protocol";

import { button, input } from "../ui";

export function Entry({ label, buttonLabel, placeholder, initial = "", onAdd }: {
  label: string;
  buttonLabel: string;
  placeholder?: string;
  initial?: string;
  onAdd: (value: string) => string | undefined | void;
}) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState("");
  const id = useId();

  function add() {
    const issue = onAdd(value.trim());
    setError(issue ?? "");
    if (!issue) setValue("");
  }

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium">{label}</label>
      <div className="flex flex-wrap items-start gap-2">
        <input id={id} value={value} placeholder={placeholder} autoCapitalize="none" spellCheck={false}
          aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined}
          onChange={(event) => { setValue(event.target.value); setError(""); }}
          onKeyDown={(event) => {
            if (event.key === "Enter") { event.preventDefault(); add(); }
          }}
          className={`${input} min-w-32 flex-1`} />
        <button type="button" onClick={add} className={button}>{buttonLabel}</button>
      </div>
      {error && <p id={`${id}-error`} role="alert" className="text-sm text-[#902f25]">{error}</p>}
    </div>
  );
}

export function AddressEntry({ label, buttonLabel, addresses, onAdd }: {
  label: string;
  buttonLabel: string;
  addresses: string[];
  onAdd: (address: string) => void;
}) {
  return (
    <Entry label={label} buttonLabel={buttonLabel} placeholder="nombre@nexo.app" onAdd={(value) => {
      const address = Address.safeParse(value);
      if (!address.success) return "Ingresa una dirección válida, por ejemplo nombre@nexo.app.";
      if (addresses.includes(address.data)) return "Esa dirección ya está en la lista.";
      onAdd(address.data);
    }} />
  );
}

export function Addresses({ values, onRemove }: { values: string[]; onRemove: (address: string) => void }) {
  if (!values.length) return null;
  return (
    <ul className="flex flex-wrap gap-2">
      {values.map((address) => (
        <li key={address} className="flex max-w-full items-center gap-1.5 rounded-lg border border-[#dce4d8] bg-[#edf2ea] px-2.5 py-0.5 text-sm">
          <span className="break-all">{address}</span>
          <button type="button" onClick={() => onRemove(address)}
            aria-label={`Quitar ${address}`}
            className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-lg text-[#345637] hover:bg-[#dbe6d7]">×</button>
        </li>
      ))}
    </ul>
  );
}

export function RuleSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-4 rounded-2xl border border-[#dfe3d7] bg-[#fffefa] p-5 sm:p-6">
      <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
      {children}
    </section>
  );
}
