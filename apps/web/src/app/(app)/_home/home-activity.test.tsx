// @vitest-environment happy-dom
import type { ActivityItem } from "@team-31/protocol";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";

import { HomeActivity } from "./home-activity";

const now = Date.parse("2026-11-21T12:00:00Z");

function renderActivity(items: ActivityItem[]) {
  const container = document.createElement("div");
  container.innerHTML = renderToStaticMarkup(<HomeActivity items={items} now={now} />);
  return container;
}

it("explica el historial vacío cuando aún no hay solicitudes", () => {
  const activity = renderActivity([]);
  expect(activity.textContent).toContain("Todavía no hay actividad");
  expect(activity.querySelector("li")).toBeNull();
});

it("asocia cada solicitud con su interlocutor, estado y antigüedad en el orden recibido", () => {
  const activity = renderActivity([
    {
      requestId: "recibida", direction: "received", from: "bruno@sideband.app", to: "ana@sideband.app",
      tool: "question", status: "denied", createdAt: "2026-11-20T12:00:00Z",
      expiresAt: "2026-11-20T13:00:00Z", events: [],
    },
    {
      requestId: "enviada", direction: "sent", from: "ana@sideband.app", to: "carla@sideband.app",
      tool: "connect", status: "answered", createdAt: "2026-11-19T12:00:00Z",
      expiresAt: "2026-11-19T13:00:00Z", events: [],
    },
  ]);

  const rows = Array.from(activity.querySelectorAll("li"), (row) => row.textContent);
  expect(rows).toHaveLength(2);
  expect(rows[0]).toContain("bruno@sideband.app te hizo una pregunta");
  expect(rows[0]).toContain("Bloqueada por permisos");
  expect(rows[0]).toMatch(/\bayer\b/);
  expect(rows[1]).toContain("Invitaste a carla@sideband.app");
  expect(rows[1]).toContain("Respondida");
  expect(rows[1]).toContain("anteayer");
});
