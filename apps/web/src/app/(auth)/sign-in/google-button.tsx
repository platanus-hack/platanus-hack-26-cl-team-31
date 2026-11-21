"use client";

import { useState } from "react";
import { authClient } from "@/lib/auth-client";

export function GoogleButton({ signedQuery }: { signedQuery?: string }) {
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  async function signIn() {
    setPending(true);
    setFailed(false);
    try {
      const result = await authClient.signIn.social({
        provider: "google",
        callbackURL: "/sign-in/complete",
        errorCallbackURL: signedQuery ? `/sign-in?${signedQuery}` : "/sign-in",
      });
      if (!result.error) return;
    } catch {
      // El mensaje es el mismo si el proveedor o la red rechazan el inicio.
    }
    setPending(false);
    setFailed(true);
  }

  return (
    <div className="mt-7">
      <button
        type="button"
        onClick={signIn}
        disabled={pending}
        className="min-h-11 w-full cursor-pointer rounded-xl bg-[#234c33] px-4 py-2.5 font-semibold text-white hover:bg-[#173623] disabled:opacity-70"
      >
        {pending ? "Conectando…" : "Entrar con Google"}
      </button>
      {failed && <p role="alert" className="mt-3 text-sm text-red-800">No se pudo abrir Google. Intenta de nuevo.</p>}
    </div>
  );
}
