// Íconos de trazo dibujados a mano (16 px, trazo 1.6) para canales y el sello de Sideband.
import type { ReactNode } from "react";

import type { FlowActor } from "./model.js";

const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round" } as const;

/** El asterisco de la marca Sideband (mismo trazo que el header de la web). */
export function SidebandMark({ size = 24 }: { size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M12 2v20M2 12h20M5 5l14 14M19 5 5 19" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="12" cy="12" r="2.4" fill="currentColor" />
    </svg>
  );
}

type IconName = "terminal" | "chat" | "claw" | "hook" | "bot" | "person";

const paths: Record<IconName, ReactNode> = {
  terminal: (
    <>
      <rect x="2" y="3" width="12" height="10" rx="2" {...stroke} />
      <path d="m5 6.5 2 1.5-2 1.5M8.5 10H11" {...stroke} />
    </>
  ),
  chat: <path d="M3 12.5 3.8 10A5 5 0 1 1 6 12.2Z" {...stroke} />,
  claw: <path d="M4 13c0-4 1.5-7 4-9M8 13c0-4 .8-6.5 2.5-8.5M12 13c0-3 .4-5 1.5-6.5M3 13h10" {...stroke} />,
  hook: <path d="M6 2.5v5a2.5 2.5 0 0 0 5 0M6 7.5a2.5 2.5 0 1 0 0 5h5M11 2.5h-1" {...stroke} />,
  bot: (
    <>
      <rect x="3" y="5" width="10" height="8" rx="2.5" {...stroke} />
      <path d="M8 5V2.8M6 9h.01M10 9h.01" {...stroke} />
    </>
  ),
  person: (
    <>
      <circle cx="8" cy="5.5" r="2.5" {...stroke} />
      <path d="M3.5 13.5a4.5 4.5 0 0 1 9 0" {...stroke} />
    </>
  ),
};

export function iconFor(actor: FlowActor): IconName {
  if (actor.role === "owner") return "person";
  const text = `${actor.channel ?? ""} ${actor.label}`.toLowerCase();
  if (text.includes("whatsapp")) return "chat";
  if (text.includes("openclaw")) return "claw";
  if (text.includes("webhook")) return "hook";
  if (text.includes("mcp") || text.includes("claude") || text.includes("codex")) return "terminal";
  return "bot";
}

export function ChannelIcon({ actor, size = 16 }: { actor: FlowActor; size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 16 16">
      {paths[iconFor(actor)]}
    </svg>
  );
}
