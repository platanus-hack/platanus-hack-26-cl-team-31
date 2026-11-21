"use client";

import { ADDRESS_DOMAIN } from "@team-31/protocol";
import { useActionState, useState } from "react";

import type { OnboardingSource } from "@/lib/onboarding-flow";

import { claimAddress } from "../actions";
import { Feedback, input, primaryButton } from "../ui";

export function AddressForm({ source }: { source: OnboardingSource }) {
  const [localPart, setLocalPart] = useState("");
  const [state, submit, pending] = useActionState(claimAddress.bind(null, source), {});

  return (
    <form action={submit} className="mt-7 space-y-5">
      <div>
        <label htmlFor="localPart" className="mb-2 block text-sm font-medium">Nombre de tu dirección</label>
        <div className="flex flex-wrap items-center gap-3">
          <input id="localPart" name="localPart" className={`${input} w-auto min-w-0 flex-1`}
            value={localPart} onChange={(event) => setLocalPart(event.target.value)}
            pattern="[a-z0-9][a-z0-9._\-]{1,30}" minLength={2} maxLength={31} required
            autoCapitalize="none" autoComplete="off" spellCheck={false} placeholder="tu-nombre" aria-describedby="address-help address-preview" />
          <span aria-hidden="true" className="font-mono text-sm font-medium text-body">@{ADDRESS_DOMAIN}</span>
        </div>
        <p id="address-help" className="mt-2 text-sm text-muted">Usa de 2 a 31 caracteres. Empieza con una letra minúscula o un número.</p>
      </div>
      <div id="address-preview" className="rounded-xl border border-line stage px-4 py-3">
        <p className="text-xs font-medium text-body">Vista previa</p>
        <p className="mt-1 break-all font-mono text-sm text-accent">{localPart || "tu-nombre"}@{ADDRESS_DOMAIN}</p>
      </div>
      <Feedback {...state} />
      <button disabled={pending} className={primaryButton}>{pending ? "Guardando…" : "Guardar dirección"}</button>
    </form>
  );
}
