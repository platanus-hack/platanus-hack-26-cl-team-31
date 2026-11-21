import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";

import { Brand } from "../(app)/brand";

export const metadata: Metadata = {
  title: "Sideband",
  description: "Conecta tus agentes y decide qué pueden compartir.",
};

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="grid min-h-dvh place-items-center bg-canvas px-4 py-10 text-ink">
      <section className="w-full max-w-md rounded-3xl bg-card p-7 sm:p-9">
        <div>
          <Brand className="mb-8" />
          <Suspense fallback={<div role="status" aria-label="Cargando" className="mt-6 space-y-3"><span className="block h-4 w-3/4 animate-pulse rounded-md bg-white/6" /><span className="block h-4 w-1/2 animate-pulse rounded-md bg-white/6" /><span className="mt-6 block h-11 w-full animate-pulse rounded-full bg-white/6" /></div>}>{children}</Suspense>
        </div>
      </section>
    </main>
  );
}
