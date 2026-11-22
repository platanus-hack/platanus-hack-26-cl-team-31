// @vitest-environment happy-dom
import type { AgentConnection } from "@team-31/protocol";
import { renderToReadableStream } from "react-dom/server";
import { expect, it, vi } from "vitest";

import { listConnections } from "../connections";
import GrokBotPage from "./page";

vi.mock("../connections", () => ({ listConnections: vi.fn() }));
vi.mock("../../../owner", () => ({ requireAddress: async () => "ana@sideband.test" }));
vi.mock("../actions", () => ({ selectConnection: vi.fn(), saveWake: vi.fn(), startPing: vi.fn() }));
vi.mock("@/lib/browser-feedback", () => ({ reportBrowserFailure: vi.fn() }));

const agentId = "rutina-de-ana";

async function renderGrok(selection: string, wakeKind: AgentConnection["wakeKind"]) {
  vi.mocked(listConnections).mockResolvedValue([{
    agentId, label: "Mi rutina", wakeKind, createdAt: "2026-11-21T12:00:00Z",
  }]);
  const stream = await renderToReadableStream(
    <GrokBotPage params={Promise.resolve({})} searchParams={Promise.resolve({ agentId: selection })} />,
  );
  await stream.allReady;
  const view = document.createElement("div");
  view.innerHTML = await new Response(stream).text();
  const button = (name: string) => Array.from(view.querySelectorAll("button")).find((item) => item.textContent === name);
  return { save: button("Guardar y probar"), remove: button("Quitar aviso"), probe: button("Probar") };
}

it("permite guardar el webhook solo para la conexión seleccionada", async () => {
  const unknown = await renderGrok("otro-agente", "grokbot_routine");
  expect(unknown.save).toBeUndefined();
  expect(unknown.remove).toBeUndefined();
  expect(unknown.probe).toBeUndefined();

  const selected = await renderGrok(agentId, "mcp_events");
  expect(selected.save?.disabled).toBe(false);
  expect(selected.remove).toBeUndefined();
  expect(selected.probe).toBeUndefined();
});

it("permite quitar o volver a probar la rutina guardada sin reingresar sus credenciales", async () => {
  const { remove, probe } = await renderGrok(agentId, "grokbot_routine");
  expect(remove?.disabled).toBe(false);
  expect(remove?.hasAttribute("formnovalidate")).toBe(true);
  expect(new FormData(remove!.form!, remove).get("operation")).toBe("remove");
  expect(probe?.disabled).toBe(false);
  expect(probe?.form?.checkValidity()).toBe(true);
});
