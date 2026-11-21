import type { Metadata } from "next";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";

import { Brand } from "./brand";
import { Navigation } from "./nav";
import { getAddress } from "./owner";

export const metadata: Metadata = {
  title: "Sideband",
  description: "Gestiona tus solicitudes, reglas y agentes en Sideband.",
};

async function Workspace({ children }: { children: ReactNode }) {
  const address = await getAddress();

  return (
    <>
      <header className="sticky top-0 z-20 border-b border-line bg-canvas/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1056px] flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
          <Link href="/" aria-label="Sideband, inicio" className="mr-2 rounded-full"><Brand /></Link>
          {address && (
            <>
              <Navigation />
              <span className="inline-flex h-8 max-w-full items-center truncate rounded-full bg-chip px-3 font-mono text-xs text-body sm:ml-auto">{address}</span>
            </>
          )}
        </div>
      </header>
      <main id="contenido" className="mx-auto w-full max-w-[1056px] px-4 pt-12 pb-20 sm:px-6 sm:pt-16">{children}</main>
    </>
  );
}

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-canvas font-sans text-ink">
      <a href="#contenido" className="sr-only rounded-full bg-card px-4 py-2 text-sm focus:not-sr-only focus:absolute focus:z-30 focus:m-3">Saltar al contenido</a>
      <Suspense fallback={<p role="status" className="mx-auto max-w-[1056px] px-6 py-10 text-[13px] text-muted">Cargando…</p>}>
        <Workspace>{children}</Workspace>
      </Suspense>
    </div>
  );
}
