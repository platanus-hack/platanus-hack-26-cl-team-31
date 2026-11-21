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
      <header className="sticky top-0 z-20 bg-canvas/90 backdrop-blur-md">
        <div className="mx-auto flex h-[68px] max-w-[1220px] items-center gap-4 px-4 sm:px-6">
          <Link href="/" aria-label="Sideband, inicio" className="rounded-full"><Brand /></Link>
          {address && (
            <span className="ml-auto inline-flex h-9 min-w-0 items-center truncate rounded-full bg-white/7 px-3.5 text-[13px] font-medium text-white/60">{address}</span>
          )}
        </div>
      </header>
      <div className="mx-auto flex max-w-[1220px] flex-col gap-6 px-4 pb-20 sm:px-6 lg:flex-row lg:gap-14">
        {address && (
          <aside className="lg:sticky lg:top-[68px] lg:h-[calc(100dvh-68px)] lg:w-[200px] lg:shrink-0 lg:pt-6">
            <Navigation />
          </aside>
        )}
        <main id="contenido" className="min-w-0 flex-1 pt-4 lg:pt-8">{children}</main>
      </div>
    </>
  );
}

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-canvas font-sans text-ink">
      <a href="#contenido" className="sr-only rounded-full bg-menu px-4 py-2 text-sm focus:not-sr-only focus:absolute focus:z-30 focus:m-3">Saltar al contenido</a>
      <Suspense fallback={<p role="status" className="mx-auto max-w-[1220px] px-6 py-10 text-[13px] text-muted">Cargando…</p>}>
        <Workspace>{children}</Workspace>
      </Suspense>
    </div>
  );
}
