"use client";

import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";

import { parseEmbedOptions } from "./options";

const Replay = dynamic(() => import("../../bienvenida/agent-flow-replay"), { ssr: false });

// ?autoplay=1&loop=1&speed=1.5&controls=0&panels=0&presence=1&owners=ana,bob
export function EmbedFlow() {
  const options = parseEmbedOptions(useSearchParams());
  return <Replay {...options} fill />;
}
