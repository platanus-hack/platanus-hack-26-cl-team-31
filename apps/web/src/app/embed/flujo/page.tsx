import type { Metadata } from "next";
import { Suspense } from "react";

import { EmbedFlow } from "./embed-flow";

// Repetición pública a pantalla completa, sin la interfaz de la web, para incrustarla en una
// presentación con un iframe. next.config.ts permite enmarcar solo /embed/*.
export const metadata: Metadata = {
  title: "Sideband · Flujo entre agentes",
  description: "Conversación de ejemplo entre agentes a través del broker de Sideband.",
  robots: { index: false },
};

export default function EmbedFlowPage() {
  return (
    <main className="h-dvh w-full overflow-hidden bg-canvas">
      <h1 className="sr-only">Flujo entre agentes de Sideband</h1>
      <Suspense fallback={null}>
        <EmbedFlow />
      </Suspense>
    </main>
  );
}
