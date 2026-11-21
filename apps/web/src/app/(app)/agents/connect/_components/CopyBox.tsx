"use client";

import { useId, useState } from "react";

import { reportBrowserFailure } from "@/lib/browser-feedback";

import { button } from "../../../ui";

export function CopyBox({ label, value, copyLabel }: { label: string; value: string; copyLabel?: string }) {
  const id = useId();
  const [feedback, setFeedback] = useState("");

  const copyManually = "Selecciona el texto para copiarlo manualmente.";

  async function copy() {
    if (!navigator.clipboard) {
      setFeedback(copyManually);
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
      setFeedback("Copiado.");
    } catch {
      setFeedback(copyManually);
      void reportBrowserFailure("copy_connection").catch(() => undefined);
    }
  }

  return (
    <figure className="min-w-0 rounded-xl stage">
      <figcaption id={id} className="flex flex-wrap items-center justify-between gap-2 px-3 pt-3 text-sm font-medium">
        {label}
        <button type="button" className={button} aria-label={copyLabel ?? `Copiar ${label}`} onClick={copy}>{copyLabel ?? "Copiar"}</button>
      </figcaption>
      <pre role="region" aria-labelledby={id} tabIndex={0} className="px-3 py-3 text-sm whitespace-pre-wrap [overflow-wrap:anywhere]">
        <code>{value}</code>
      </pre>
      <p role="status" className={feedback ? "px-3 pb-3 text-xs text-accent" : "sr-only"}>{feedback}</p>
    </figure>
  );
}
