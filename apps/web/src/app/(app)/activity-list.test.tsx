import type { ActivityItem } from "@team-31/protocol";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";

import { ActivityList } from "./activity-list";

const base = {
  requestId: "req-1", from: "martin@sideband.app", to: "ana@sideband.app", tool: "question", status: "denied",
  createdAt: "2026-11-21T15:34:00.000Z", expiresAt: "2026-11-21T16:34:00.000Z", events: [],
} satisfies Omit<ActivityItem, "direction">;

it("muestra al destinatario el motivo de la denegación y dónde dar el permiso", () => {
  const item: ActivityItem = { ...base, direction: "received", decisionReason: "Sin permiso para esta herramienta." };
  const html = renderToStaticMarkup(<ActivityList items={[item]} />);
  expect(html).toContain("Sin permiso para esta herramienta.");
  expect(html).toContain('href="/contacts"');
  expect(html).toContain("Revisa qué le compartes a martin@sideband.app");
});

it("no muestra motivo en las solicitudes enviadas", () => {
  const item: ActivityItem = { ...base, direction: "sent" };
  const html = renderToStaticMarkup(<ActivityList items={[item]} />);
  expect(html).not.toContain("Motivo");
  expect(html).not.toContain('href="/contacts"');
});
