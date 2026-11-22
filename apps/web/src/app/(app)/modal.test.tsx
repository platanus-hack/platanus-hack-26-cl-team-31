// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, onTestFinished, vi } from "vitest";

import { Modal } from "./modal";

it("mantiene abierto el diálogo al reabrirlo después de pulsar Cerrar dos veces", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  onTestFinished(async () => {
    await act(() => root.unmount());
    host.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  await act(() => root.render(<Modal label="Ver detalle" title="Detalle">Contenido</Modal>));
  const open = host.querySelector("button")!;
  const dialog = host.querySelector("dialog")!;
  const close = dialog.querySelector<HTMLButtonElement>('button[aria-label="Cerrar"]')!;

  await act(() => open.click());
  await act(() => close.click());
  await act(() => { vi.advanceTimersByTime(10); });
  expect(dialog.open).toBe(true);
  await act(() => close.click());
  await act(() => { vi.advanceTimersToNextTimer(); });
  expect(dialog.open).toBe(false);

  await act(() => open.click());
  await act(() => { vi.runAllTimers(); });
  expect(dialog.open).toBe(true);
});
