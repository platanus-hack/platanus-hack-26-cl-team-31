// @vitest-environment happy-dom
import { RESULT_EVENT, RESULT_ROUTING_INSTRUCTION, SAVE_RESULT_ORIGIN, type AgentConnection } from "@team-31/protocol";
import { renderToReadableStream } from "react-dom/server";
import { expect, it, vi } from "vitest";

import { listConnections } from "../connections";
import DotPage from "./page";

vi.mock("../connections", () => ({ listConnections: vi.fn() }));
vi.mock("../../../owner", () => ({ requireAddress: async () => "ana@sideband.app" }));
vi.mock("../actions", () => ({ selectConnection: vi.fn(), startPing: vi.fn() }));
vi.mock("@/lib/browser-feedback", () => ({ reportBrowserFailure: vi.fn() }));

const agentId = "asistente/equipo & familia";

async function renderDot(selection: string | string[] | undefined, wakeKind: AgentConnection["wakeKind"]) {
  vi.mocked(listConnections).mockResolvedValue([{
    agentId, label: "Mi asistente", wakeKind, createdAt: "2026-11-21T12:00:00Z",
  }]);
  const stream = await renderToReadableStream(
    <DotPage params={Promise.resolve({})} searchParams={Promise.resolve({ agentId: selection })} />,
  );
  await stream.allReady;
  const view = document.createElement("div");
  view.innerHTML = await new Response(stream).text();
  const refresh = Array.from(view.querySelectorAll("a")).find((link) => link.textContent === "Actualizar conexiones");
  const probe = Array.from(view.querySelectorAll("button")).find((button) => button.textContent === "Probar");
  return { view, refresh: refresh?.getAttribute("href"), probe };
}

it("conserva el agente al actualizar y habilita la prueba cuando se suscribe a eventos MCP", async () => {
  const before = await renderDot(agentId, "openclaw_hooks");
  expect(before.probe).toBeUndefined();
  expect(before.refresh).toBe(`/agents/connect/dot?agentId=${encodeURIComponent(agentId)}`);

  const after = await renderDot(agentId, "mcp_events");
  expect(after.refresh).toBe(before.refresh);
  expect(after.probe?.disabled).toBe(false);
});

it("incluye en el bloque de confianza copiable la regla para entregar respuestas en el chat de origen", async () => {
  const { view } = await renderDot(undefined, "none");
  const copy = view.querySelector('button[aria-label="Copiar Bloque de confianza"]');
  const snippet = copy?.closest("figure")?.querySelector('[role="region"]')?.textContent;
  expect(snippet).toContain(SAVE_RESULT_ORIGIN);
  expect(snippet).toContain(`${RESULT_EVENT}: ${RESULT_ROUTING_INSTRUCTION}`);
});

it.each([
  { selection: undefined },
  { selection: "otro-agente" },
  { selection: [agentId, "otro-agente"] },
])("pide elegir agente cuando la selección es $selection, aunque haya una suscripción activa", async ({ selection }) => {
  const { refresh, probe } = await renderDot(selection, "mcp_events");
  expect(refresh).toBe("/agents/connect/dot");
  expect(probe).toBeUndefined();
});
