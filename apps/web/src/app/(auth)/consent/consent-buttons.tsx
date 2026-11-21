"use client";

import { useState } from "react";
import { authClient } from "@/lib/auth-client";

export function ConsentButtons() {
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  async function submit(accept: boolean) {
    setPending(true);
    setFailed(false);
    try {
      const { data } = await authClient.oauth2.consent({ accept });
      if (data?.redirect && data.url) {
        window.location.assign(data.url);
        return;
      }
    } catch {
      // La pantalla se conserva para que la persona pueda reintentar.
    }
    setPending(false);
    setFailed(true);
  }

  return (
    <div className="mt-7">
      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          disabled={pending}
          onClick={() => submit(false)}
          className="min-h-11 cursor-pointer rounded-xl border border-[#bbc6b6] px-4 py-2.5 font-semibold hover:bg-[#eef1e8] disabled:opacity-70"
        >
          Cancelar
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => submit(true)}
          className="min-h-11 cursor-pointer rounded-xl bg-[#234c33] px-4 py-2.5 font-semibold text-white hover:bg-[#173623] disabled:opacity-70"
        >
          Autorizar
        </button>
      </div>
      {failed && <p role="alert" className="mt-3 text-sm text-red-800">No se pudo enviar tu respuesta. Si el enlace venció, reinicia la conexión desde el agente.</p>}
    </div>
  );
}
