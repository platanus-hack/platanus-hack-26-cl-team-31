// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { LiveActivity } from "./live-activity";

class TestSource extends EventTarget {
  static CLOSED = 2;
  readyState = 0;
  onopen?: () => void;
  onerror?: () => void;
  close = vi.fn();

  constructor() {
    super();
    sources.push(this);
  }
}

const sources: TestSource[] = [];
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  vi.stubGlobal("EventSource", TestSource);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(() => root.render(<LiveActivity />));
});

afterEach(async () => {
  await act(() => root.unmount());
  host.remove();
  sources.length = 0;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function advance(ms: number) {
  await act(() => vi.advanceTimersByTimeAsync(ms));
}

it("actualiza una sola fila y mantiene el resaltado desde su último evento", async () => {
  const item = {
    requestId: "req-1", direction: "sent", from: "ana@sideband.app", to: "bob@sideband.app",
    tool: "question", createdAt: "2026-11-21T12:00:00Z", expiresAt: "2026-11-21T12:15:00Z", events: [],
  };
  async function update(status: string) {
    const data = JSON.stringify({ ...item, status });
    await act(() => { sources[0].dispatchEvent(new MessageEvent("activity", { data })); });
  }

  await update("awaiting_agent");
  const row = host.querySelector<HTMLButtonElement>("button[aria-label^='Ver detalle']")!;
  expect(row.textContent).toContain("Esperando al agente");
  await advance(1200);
  expect(row.classList.contains("bg-accent-soft")).toBe(true);

  await update("answered");
  await advance(300);
  expect(host.querySelectorAll("ul > li")).toHaveLength(1);
  expect(row.textContent).toContain("Respondida");
  expect(row.classList.contains("bg-accent-soft")).toBe(true);
  await advance(1200);
  expect(row.classList.contains("bg-accent-soft")).toBe(false);
});

it("reabre un stream cerrado y cancela el siguiente reintento al salir del cable", async () => {
  await act(() => sources[0].onerror?.());
  await advance(1_000);
  expect(sources).toHaveLength(1);
  expect(host.querySelector("[role=status]")?.textContent).toBe("Reconectando…");

  sources[0].readyState = TestSource.CLOSED;
  await act(() => sources[0].onerror?.());
  await advance(1_000);
  expect(sources).toHaveLength(2);
  await act(() => sources[1].onopen?.());
  expect(host.querySelector("[role=status]")?.textContent).toBe("En vivo");

  sources[1].readyState = TestSource.CLOSED;
  await act(() => sources[1].onerror?.());
  await act(() => root.render(null));
  await advance(15_000);
  expect(sources[1].close).toHaveBeenCalledOnce();
  expect(sources).toHaveLength(2);
});
