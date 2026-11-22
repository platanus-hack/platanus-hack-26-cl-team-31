// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, onTestFinished, vi } from "vitest";

import { DevLoginForm } from "./dev-login-form";

vi.mock("@/lib/browser-feedback", () => ({ reportBrowserFailure: async () => {} }));

it("avisa al titular si la API rechaza el inicio de sesión de prueba", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 403 })));
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  onTestFinished(async () => {
    await act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  await act(() => root.render(<DevLoginForm next="/sign-in/complete" />));
  host.querySelector("input")!.value = "Ana";
  await act(async () => { host.querySelector("button")!.click(); });

  expect(host.querySelector('[role="alert"]')?.textContent).toContain("No se pudo iniciar la sesión");
});
