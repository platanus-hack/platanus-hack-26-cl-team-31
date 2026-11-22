import { useEffect, useState } from "react";
import type { ModelState } from "@/lib/demo";

export type DemoMode = "contacts" | "coordination";
type Services = { api?: boolean; model?: ModelState; contacts?: boolean };

const connectionInfo = {
  connecting: { label: "Conectando…", notice: null },
  ready: { label: "Agente listo", notice: null },
  contactsOffline: { label: "Agente sin conexión", notice: <>Inicia el broker local y prepara la agenda con <code>pnpm agents:contacts:seed</code>.</> },
  apiOffline: { label: "API desconectada", notice: <>Levanta la API con <code>pnpm agents:up 3</code>.</> },
  missing: { label: "Modelo no instalado", notice: "Ollama está conectado. Si el modelo se está descargando, el chat se habilitará al terminar. Si no, sigue los pasos del README." },
  offline: { label: "Ollama sin conexión", notice: "No hay conexión con Ollama. Inícialo siguiendo los pasos del README." },
};

function connectionState(mode: DemoMode, services: Services | null) {
  if (mode === "contacts") {
    if (services?.contacts === undefined) return "connecting";
    return services.contacts ? "ready" : "contactsOffline";
  }
  if (services?.model === undefined) return "connecting";
  return services.api ? services.model : "apiOffline";
}

function offline(mode: DemoMode): Services {
  return mode === "contacts" ? { contacts: false } : { api: false, model: "offline" };
}

export function useDemoConnection(mode: DemoMode) {
  const [services, setServices] = useState<Services | null>(null);
  const [revision, setRevision] = useState(0);
  const refresh = () => setRevision(value => value + 1);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function check() {
      try {
        const url = mode === "contacts" ? "/api/demo?mode=contacts" : "/api/demo";
        const response = await fetch(url, { signal: controller.signal });
        const state = await response.json();
        if (!controller.signal.aborted) setServices(state);
        if (response.ok) return;
      } catch {
        if (!controller.signal.aborted) setServices(offline(mode));
      }
      if (!controller.signal.aborted) timer = setTimeout(check, 8000);
    }
    void check();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [mode, revision]);

  const state = connectionState(mode, services);
  return { ...connectionInfo[state], ready: state === "ready", refresh, disconnect: () => setServices(offline(mode)) };
}
