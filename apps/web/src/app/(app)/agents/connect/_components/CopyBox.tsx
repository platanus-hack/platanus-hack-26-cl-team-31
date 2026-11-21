"use client";

import { useId, useState } from "react";

import { button } from "../../../ui";

export function CopyBox({ label, value, copyLabel }: { label: string; value: string; copyLabel?: string }) {
  const id = useId();
  const [feedback, setFeedback] = useState("");

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setFeedback("Copiado.");
    } catch {
      setFeedback("Selecciona el texto para copiarlo manualmente.");
    }
  }

  return (
    <figure className="min-w-0 rounded-lg border border-[#dfe3d7] bg-[#f3f5ed]">
      <figcaption id={id} className="flex flex-wrap items-center justify-between gap-2 px-3 pt-3 text-sm font-semibold">
        {label}
        <button type="button" className={button} aria-label={copyLabel ?? `Copiar ${label}`} onClick={copy}>{copyLabel ?? "Copiar"}</button>
      </figcaption>
      <pre role="region" aria-labelledby={id} tabIndex={0} className="px-3 py-3 text-sm whitespace-pre-wrap [overflow-wrap:anywhere]">
        <code>{value}</code>
      </pre>
      <p role="status" className={feedback ? "px-3 pb-3 text-xs text-[#28513b]" : "sr-only"}>{feedback}</p>
    </figure>
  );
}
