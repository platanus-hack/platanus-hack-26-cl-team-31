// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Dashboard } from "./dashboard";

const fetchDemo = vi.fn<typeof fetch>();
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", fetchDemo);
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
});

afterEach(async () => {
  await act(() => root.unmount());
  host.remove();
  fetchDemo.mockReset();
  vi.unstubAllGlobals();
});

function changeMode(mode: string) {
  return act(() => {
    const select = host.querySelector("select")!;
    select.value = mode;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function write(message: string) {
  return act(() => {
    const field = host.querySelector("textarea")!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, message);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function submitButton() {
  return host.querySelector<HTMLButtonElement>('button[type="submit"]')!;
}

it("espera los servicios del modo activo aunque la consulta de contactos termine después", async () => {
  const contacts = Promise.withResolvers<Response>();
  fetchDemo.mockReturnValueOnce(contacts.promise)
    .mockResolvedValueOnce(Response.json({ api: true, model: "missing" }, { status: 503 }))
    .mockResolvedValueOnce(Response.json({ api: true, model: "ready" }));
  await act(() => root.render(<Dashboard />));
  await changeMode("coordination");
  await write("¿Cuándo jugamos?");
  await act(() => contacts.resolve(Response.json({ contacts: true })));
  expect(host.querySelector('[role="status"]')?.textContent).toContain("descargando");
  expect(submitButton().disabled).toBe(true);

  await act(() => host.querySelector<HTMLButtonElement>('[title="Comprobar conexión"]')!.click());
  expect(host.querySelector('[role="status"]')).toBeNull();
  expect(submitButton().disabled).toBe(false);
});

it("conserva la solicitud y el encuentro al retomar fútbol y resume las consultas previas", async () => {
  fetchDemo.mockResolvedValueOnce(Response.json({ contacts: true }))
    .mockResolvedValueOnce(Response.json({ api: true, model: "ready" }))
    .mockResolvedValueOnce(Response.json({ text: "Respuesta del agente", traces: [
      { tool: "availability_check", input: { recipient: "bob", slot: "2026-11-28T18:00:00-03:00" }, data: { request_id: "consulta" } },
      { tool: "meeting_propose", input: {}, data: { id: "encuentro" } },
    ] }))
    .mockResolvedValueOnce(Response.json({ contacts: true }))
    .mockResolvedValueOnce(Response.json({ api: true, model: "ready" }))
    .mockResolvedValueOnce(Response.json({ text: "Segunda respuesta" }));
  await act(() => root.render(<Dashboard />));
  await changeMode("coordination");
  await write("¿Puede Bob a las seis?");
  await act(() => submitButton().click());
  expect(host.querySelector('[role="log"]')?.textContent).toContain("Respuesta del agente");
  await changeMode("contacts");
  expect(host.querySelector('[role="log"]')).toBeNull();
  await changeMode("coordination");
  await write("  ¿Y a las cuatro?  ");
  await act(() => {
    host.querySelector("textarea")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  const posts = fetchDemo.mock.calls.filter(([, init]) => init?.method === "POST");
  expect(posts).toHaveLength(2);
  expect(JSON.parse(String(posts[1][1]?.body))).toEqual({
    person: "ana", mode: "coordination", message: "¿Y a las cuatro?", meetingId: "encuentro", requestId: "consulta",
    history: [
      { role: "user", content: "¿Puede Bob a las seis?" },
      { role: "assistant", content: "La pregunta anterior era por la disponibilidad de bob a las 18:00 (Santiago)." },
    ],
  });
});
