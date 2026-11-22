// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import { readPingStatus, saveWake } from "../actions";
import { WakeForm } from "./WakeForm";

vi.mock("../actions", () => ({ saveWake: vi.fn(), readPingStatus: vi.fn(), startPing: vi.fn() }));
vi.mock("@/lib/browser-feedback", () => ({ reportBrowserFailure: vi.fn() }));

it("sigue automáticamente la prueba que GrokBot inició al guardar el aviso", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  vi.mocked(saveWake).mockResolvedValue({ requestId: "prueba-del-guardado" });
  vi.mocked(readPingStatus).mockResolvedValue({ status: "answered", verified: true });
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);

  try {
    await act(() => root.render(
      <WakeForm kind="grokbot" agentId="rutina" configuredAddress="ana@sideband.test" />,
    ));
    const form = host.querySelector("form")!;
    form.querySelector<HTMLInputElement>('[name="url"]')!.value = "https://example.test/rutina";
    form.querySelector<HTMLInputElement>('[name="secret"]')!.value = "clave-de-prueba-local";
    await act(() => form.querySelector("button")!.click());
    await act(async () => { await vi.advanceTimersToNextTimerAsync(); });

    expect(readPingStatus).toHaveBeenCalledExactlyOnceWith("prueba-del-guardado");
  } finally {
    await act(() => root.unmount());
    host.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});
