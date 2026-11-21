"use client";

import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { reportBrowserFailure } from "@/lib/browser-feedback";

export function GoogleButton({ callbackURL, errorCallbackURL }: { callbackURL: string; errorCallbackURL: string }) {
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  async function signIn() {
    setPending(true);
    setFailed(false);
    try {
      const result = await authClient.signIn.social({
        provider: "google",
        callbackURL,
        errorCallbackURL,
      });
      if (!result.error) return;
    } catch {
      // El mensaje es el mismo si el proveedor o la red rechazan el inicio.
    }
    setPending(false);
    setFailed(true);
    void reportBrowserFailure("start_google").catch(() => undefined);
  }

  return (
    <div className="mt-7">
      <button
        type="button"
        onClick={signIn}
        disabled={pending}
        className="min-h-11 w-full cursor-pointer rounded-full bg-accent px-4 py-2.5 text-[13px] font-medium text-white raised transition hover:bg-accent-hover disabled:opacity-70"
      >
        {pending ? "Conectando…" : "Entrar con Google"}
      </button>
      {failed && <p role="alert" className="mt-3 text-sm text-danger">No se pudo abrir Google. Intenta de nuevo.</p>}
    </div>
  );
}
