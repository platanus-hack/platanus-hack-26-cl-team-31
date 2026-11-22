// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { Feedback } from "../action-feedback";
import { pingOrRevokeAgent } from "./actions";
import { AgentControls } from "./agent-controls";

vi.mock("./actions", () => ({ pingOrRevokeAgent: vi.fn() }));

const agentId = "calendario/equipo & familia";
const action = vi.mocked(pingOrRevokeAgent);
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
});

afterEach(async () => {
  await act(() => root.unmount());
  host.remove();
  action.mockReset();
  vi.unstubAllGlobals();
});

function button(label: string) {
  const control = [...host.querySelectorAll("button")].find((node) => node.textContent === label);
  expect(control, label).toBeDefined();
  return control!;
}

function submissions() {
  return action.mock.calls.map(([id, , form]) => [id, form.get("operation")]);
}

it("dirige la configuración y la prueba al agente elegido e impide repetir una prueba pendiente", async () => {
  const reply = Promise.withResolvers<Feedback>();
  action.mockReturnValueOnce(reply.promise);
  await act(() => root.render(<AgentControls agentId={agentId} revoked={false} />));
  const link = new URL(host.querySelector("a")!.href);
  expect(link.pathname).toBe("/agents/connect");
  expect(link.searchParams.get("agentId")).toBe(agentId);

  await act(() => button("Probar").click());
  expect(host.querySelector('[role="status"]')?.textContent).toContain("Prueba solicitada");
  expect(button("Probar").disabled).toBe(true);
  expect(button("Desconectar").disabled).toBe(true);
  await act(() => button("Probar").click());
  expect(submissions()).toEqual([[agentId, "ping"]]);

  await act(() => reply.resolve({ message: "Prueba recibida." }));
  expect(host.querySelector('[role="status"]')?.textContent).toBe("Prueba recibida.");
  expect(button("Probar").disabled).toBe(false);
});

it("permite cancelar sin enviar la desconexión y reintentar si falla tras confirmarla", async () => {
  const reply = Promise.withResolvers<Feedback>();
  action.mockReturnValueOnce(reply.promise).mockResolvedValueOnce({ message: "Agente desconectado." });
  await act(() => root.render(<AgentControls agentId={agentId} revoked={false} />));

  await act(() => button("Desconectar").click());
  await act(() => button("Cancelar").click());
  await act(() => button("Desconectar").click());
  expect(action).not.toHaveBeenCalled();
  await act(() => button("Confirmar desconexión").click());
  expect(submissions()).toEqual([[agentId, "revoke"]]);
  expect(host.querySelector('[role="status"]')?.textContent).toBe("Agente desconectado.");
  expect(host.querySelector("button, a")).toBeNull();

  await act(() => reply.resolve({ error: "No se pudo desconectar." }));
  expect(host.querySelector('[role="status"]')).toBeNull();
  expect(host.querySelector('[role="alert"]')?.textContent).toBe("No se pudo desconectar.");
  await act(() => button("Confirmar desconexión").click());
  expect(submissions()).toEqual([[agentId, "revoke"], [agentId, "revoke"]]);
  expect(host.querySelector('[role="alert"]')).toBeNull();
});

it("retira las acciones al actualizarse la conexión como revocada", async () => {
  await act(() => root.render(<AgentControls agentId={agentId} revoked={false} />));
  await act(() => button("Desconectar").click());
  await act(() => root.render(<AgentControls agentId={agentId} revoked />));

  expect(host.querySelector("button, a")).toBeNull();
  expect(action).not.toHaveBeenCalled();
});
