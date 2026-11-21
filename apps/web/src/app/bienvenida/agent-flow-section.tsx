"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";

const height = "min(720px, 150vw)";

const AgentFlowReplay = dynamic(() => import("./agent-flow-replay"), {
  ssr: false,
  loading: () => <Placeholder />,
});

function Placeholder() {
  return (
    <div style={{ minHeight: height }} className="grid place-items-center rounded-[16px] stage text-sm text-muted">
      Cargando la conversación de ejemplo…
    </div>
  );
}

// El visualizador no participa del primer render: se descarga cuando la sección se acerca a la
// pantalla y ocupa un alto reservado para no mover el contenido.
export function AgentFlowSection() {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "400px 0px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} style={{ minHeight: height }}>
      {visible ? <AgentFlowReplay /> : <Placeholder />}
    </div>
  );
}
