"use client";

import { useState } from "react";

import { reportBrowserFailure } from "@/lib/browser-feedback";

/**
 * Entrada de desarrollo: un nombre basta para crear e iniciar sesión como un titular de prueba.
 * Solo se renderiza con SIDEBAND_DEV_AUTH=1. `next` lo calcula el servidor, así que el flujo OAuth
 * continúa en /consent como con Google: el consentimiento no se salta.
 */
export function DevLoginForm({ next }: { next: string }) {
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  async function signIn(form: FormData) {
    setPending(true);
    setFailed(false);
    try {
      const response = await fetch("/api/dev-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: String(form.get("name") ?? "") }),
      });
      if (response.ok) {
        window.location.href = next;
        return;
      }
    } catch {
      // El mensaje es el mismo si la red o la ruta rechazan el inicio.
    }
    setPending(false);
    setFailed(true);
    void reportBrowserFailure("start_dev_login").catch(() => undefined);
  }

  return (
    <form action={signIn} className="mt-7 border-t border-dashed pt-6">
      <label htmlFor="dev-login-name" className="text-sm font-medium">
        Titular de prueba (solo desarrollo)
      </label>
      <input
        id="dev-login-name"
        name="name"
        required
        maxLength={100}
        placeholder="Ana"
        className="mt-2 min-h-11 w-full rounded-full stage px-4 py-2.5 text-[13px]"
      />
      <button
        type="submit"
        disabled={pending}
        className="mt-3 min-h-11 w-full cursor-pointer rounded-full stage px-4 py-2.5 text-[13px] font-medium transition disabled:opacity-70"
      >
        {pending ? "Entrando…" : "Entrar como titular de prueba"}
      </button>
      {failed && <p role="alert" className="mt-3 text-sm text-danger">No se pudo iniciar la sesión de prueba.</p>}
    </form>
  );
}
