// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { reportBrowserFailure } from "@/lib/browser-feedback";
import { CopyBox } from "./CopyBox";

vi.mock("@/lib/browser-feedback", () => ({
  reportBrowserFailure: vi.fn().mockResolvedValue(undefined),
}));

const value = '{\n  "transport": "streamable-http"\n}';
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(() => root.render(<CopyBox label="Configuración MCP" value={value} />));
});

afterEach(async () => {
  await act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

async function clickCopy() {
  await act(() => host.querySelector<HTMLButtonElement>('button[aria-label="Copiar Configuración MCP"]')!.click());
}

it("copia el bloque completo y espera la escritura antes de confirmar", async () => {
  const pending = Promise.withResolvers<void>();
  const write = vi.spyOn(navigator.clipboard, "writeText").mockReturnValue(pending.promise);
  await clickCopy();

  expect(write).toHaveBeenCalledExactlyOnceWith(value);
  const status = host.querySelector('[role="status"]')!;
  expect(status.textContent).toBe("");
  await act(() => pending.resolve());
  expect(status.textContent).toBe("Copiado.");
  expect(reportBrowserFailure).not.toHaveBeenCalled();
});

function expectManualCopy() {
  expect(host.querySelector('[role="status"]')?.textContent).toBe("Selecciona el texto para copiarlo manualmente.");
  expect(host.querySelector('[role="region"]')?.textContent).toBe(value);
}

it("ofrece el texto para copia manual si el navegador carece de portapapeles", async () => {
  vi.stubGlobal("navigator", {});
  await clickCopy();

  expectManualCopy();
  expect(reportBrowserFailure).not.toHaveBeenCalled();
});

it("ofrece copia manual e informa solo la operación si se deniega la escritura", async () => {
  vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("Permiso denegado"));
  await clickCopy();

  expectManualCopy();
  expect(reportBrowserFailure).toHaveBeenCalledExactlyOnceWith("copy_connection");
});
