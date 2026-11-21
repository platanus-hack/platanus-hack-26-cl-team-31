"use client";

import { useMemo } from "react";
import { AgentFlow } from "@team-31/agent-flow";
import { scenarioEvents } from "@team-31/agent-flow/scenario";

import type { EmbedOptions } from "../embed/flujo/options";

// Repetición sin backend: el escenario ficticio pasa por el mismo mapeo de telemetría que el modo
// en vivo del admin. La landing la carga al entrar en pantalla y /embed/flujo a pantalla completa.
export default function AgentFlowReplay({ owners, fill, ...options }: Partial<EmbedOptions> & { fill?: boolean }) {
  const events = useMemo(() => scenarioEvents(), []);
  return (
    <AgentFlow
      mode="replay"
      events={events}
      title="Conversación de ejemplo entre los agentes de Ana, Bob, Carla y Dani"
      defaultOwners={owners}
      fill={fill}
      {...options}
    />
  );
}
