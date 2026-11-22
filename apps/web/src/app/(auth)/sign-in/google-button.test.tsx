// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import { GoogleButton } from "./google-button";

const social = vi.hoisted(() => vi.fn());
vi.mock("@/lib/load-auth-client", () => ({
  loadAuthClient: async () => ({ signIn: { social } }),
}));
vi.mock("@/lib/browser-feedback", () => ({ reportBrowserFailure: async () => {} }));

it("permite reintentar cuando Google devuelve un error al iniciar sesión", async () => {
  social.mockResolvedValueOnce({ error: { status: 503 } }).mockResolvedValueOnce({ error: null });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  const root = createRoot(host);
  try {
    await act(() => root.render(<GoogleButton callbackURL="/sign-in/complete" errorCallbackURL="/sign-in" />));
    const button = host.querySelector("button")!;
    await act(() => button.click());
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Intenta de nuevo");

    await act(() => button.click());
    expect(social).toHaveBeenCalledTimes(2);
  } finally {
    await act(() => root.unmount());
    vi.unstubAllGlobals();
  }
});
