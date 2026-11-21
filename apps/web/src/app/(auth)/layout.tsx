import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";

export const metadata: Metadata = {
  title: "Nexo",
  description: "Conecta tus agentes y decide qué pueden compartir.",
};

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main lang="es" className="grid min-h-dvh place-items-center bg-[#f5f5ef] px-4 py-10 text-[#20261d]">
      <section className="w-full max-w-md rounded-3xl border border-[#e3e5da] bg-[#fffefa] p-6 shadow-sm sm:p-9">
        <p className="mb-8 text-xl font-bold tracking-tight">Nexo<span className="text-[#54824b]">.</span></p>
        <Suspense fallback={<p role="status">Cargando…</p>}>{children}</Suspense>
      </section>
    </main>
  );
}
