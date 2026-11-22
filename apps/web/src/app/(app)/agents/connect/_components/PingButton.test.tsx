// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { readPingStatus, startPing } from "../actions";
import { PingButton } from "./PingButton";

vi.mock("../actions", () => ({ readPingStatus: vi.fn(), startPing: vi.fn() }));
vi.mock("@/lib/browser-feedback", () => ({ reportBrowserFailure: vi.fn() }));

const start = vi.mocked(startPing);
const read = vi.mocked(readPingStatus);
const address = "ana@sideband.test";
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
});

afterEach(async () => {
  await act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

function advance(ms: number) {
  return act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

function probeButton() {
  return host.querySelector<HTMLButtonElement>("form button")!;
}

function status() {
  return host.querySelector('[role="status"]')!.textContent;
}

function resume(requestId: string) {
  return act(() => root.render(
    <PingButton key={requestId} agentId="rutina" kind="grokbot" address={address} initialRequestId={requestId} />,
  ));
}

it("permite reintentar un envío fallido y sigue la solicitud del agente seleccionado", async () => {
  const pending = Promise.withResolvers<Awaited<ReturnType<typeof startPing>>>();
  start.mockReturnValueOnce(pending.promise).mockResolvedValueOnce({ requestId: "ping-dot" });
  read.mockResolvedValue({ status: "answered", verified: true });
  await act(() => root.render(<PingButton agentId="agente-dot" kind="dot" address={address} />));

  await act(() => probeButton().click());
  expect(start.mock.calls[0].slice(0, 2)).toEqual(["dot", "agente-dot"]);
  expect(probeButton().disabled).toBe(true);
  await act(() => probeButton().click());
  expect(start).toHaveBeenCalledTimes(1);

  await act(() => pending.resolve({ error: "Envío fallido", errorId: "error-envio" }));
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("error-envio");
  await advance(5000);
  expect(read).not.toHaveBeenCalled();
  await act(() => probeButton().click());
  expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(probeButton().disabled).toBe(true);
  expect(host.textContent).not.toContain(address);

  await advance(1000);
  expect(read).toHaveBeenCalledExactlyOnceWith("ping-dot");
  expect(status()).toContain("El agente respondió");
  expect(host.querySelector('[role="region"]')?.textContent).toBe(address);
  expect(probeButton().disabled).toBe(false);
  await advance(5000);
  expect(read).toHaveBeenCalledTimes(1);
});

it("conserva la espera del titular ante errores de lectura y recupera la prueba guardada", async () => {
  read.mockResolvedValueOnce({ status: "awaiting_owner", verified: false })
    .mockResolvedValueOnce({ errorId: "error-lectura" })
    .mockRejectedValueOnce(new Error("sin conexión"))
    .mockResolvedValueOnce({ status: "no_data", verified: true });
  await resume("ping-guardado");
  await advance(1000);
  expect(status()).toContain("pidió tu decisión");
  await advance(2000);
  expect(status()).toContain("pidió tu decisión");
  expect(status()).toContain("error-lectura");
  await advance(2000);
  expect(status()).toContain("Volveremos a consultar");
  expect(status()).not.toContain("error-lectura");
  expect(probeButton().disabled).toBe(true);
  expect(host.textContent).not.toContain(address);

  await advance(2000);
  expect(host.textContent).toContain(address);
  expect(status()).not.toContain("Volveremos a consultar");
  expect(read.mock.calls).toEqual(Array(4).fill(["ping-guardado"]));
  expect(start).not.toHaveBeenCalled();
});

it.each([
  [{ status: "answered", verified: false } as const, "sin una respuesta final del agente"],
  [undefined, "ya no está disponible"],
])("cierra la consulta sin ofrecer la dirección cuando la prueba queda %j", async (result, message) => {
  read.mockResolvedValue(result);
  await resume("ping-cerrado");
  await advance(1000);
  expect(status()).toContain(message);
  expect(host.textContent).not.toContain(address);
  expect(probeButton().disabled).toBe(false);
  await advance(5000);
  expect(read).toHaveBeenCalledExactlyOnceWith("ping-cerrado");
});

it("descarta una lectura pendiente al reemplazar la prueba guardada", async () => {
  const previous = Promise.withResolvers<Awaited<ReturnType<typeof readPingStatus>>>();
  read.mockReturnValueOnce(previous.promise).mockResolvedValueOnce({ status: "expired", verified: false });
  await resume("anterior");
  await advance(5000);
  expect(read).toHaveBeenCalledExactlyOnceWith("anterior");
  await resume("actual");
  await act(() => previous.resolve({ status: "answered", verified: true }));
  expect(host.textContent).not.toContain(address);
  expect(probeButton().disabled).toBe(true);
  await advance(1000);
  expect(status()).toContain("venció");
  await advance(5000);
  expect(read.mock.calls).toEqual([["anterior"], ["actual"]]);
});
