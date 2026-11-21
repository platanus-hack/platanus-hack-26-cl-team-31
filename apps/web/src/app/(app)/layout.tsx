import type { Metadata } from "next";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";

import { Navigation } from "./nav";
import { getAddress } from "./owner";

export const metadata: Metadata = {
  title: "Nexo",
  description: "Gestiona tus solicitudes, reglas y agentes en Nexo.",
};

async function Workspace({ children }: { children: ReactNode }) {
  const address = await getAddress();

  return (
    <>
      <header className="border-b border-[#e1e5da] bg-[#fffefa]">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-8 gap-y-3 px-5 py-4 sm:px-8">
          <Link href="/" aria-label="Nexo, inicio" className="text-2xl font-bold tracking-tight">Nexo<span aria-hidden="true" className="text-[#54824b]">.</span></Link>
          {address && (
            <>
              <Navigation />
              <span className="max-w-full break-all rounded-lg bg-[#f1f3eb] px-2.5 py-1.5 font-mono text-xs text-[#3b5138] sm:ml-auto">{address}</span>
            </>
          )}
        </div>
      </header>
      <main id="contenido" className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-8 sm:py-12">{children}</main>
    </>
  );
}

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div lang="es" className="min-h-dvh bg-[#f5f5ef] font-sans text-[#20261d]">
      <a href="#contenido" className="sr-only rounded-lg bg-white p-3 focus:not-sr-only focus:absolute focus:z-10">Saltar al contenido</a>
      <Suspense fallback={<p role="status" className="mx-auto max-w-6xl px-5 py-10 text-sm text-[#525e50]">Cargando…</p>}>
        <Workspace>{children}</Workspace>
      </Suspense>
    </div>
  );
}
