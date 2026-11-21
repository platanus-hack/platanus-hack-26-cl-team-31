import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";

import { Brand } from "../(app)/brand";

export const metadata: Metadata = {
  title: "Nexo",
  description: "Conecta tus agentes y decide qué pueden compartir.",
};

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="grid min-h-dvh place-items-center bg-canvas px-4 py-10 text-ink">
      <section className="w-full max-w-md rounded-3xl bg-card p-3 surface ring-1 ring-line">
        <div className="rounded-[14px] p-6 stage sm:p-8">
          <Brand className="mb-8" />
          <Suspense fallback={<p role="status" className="text-[13px] text-muted">Cargando…</p>}>{children}</Suspense>
        </div>
      </section>
    </main>
  );
}
