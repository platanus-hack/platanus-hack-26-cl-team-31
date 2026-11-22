// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { AccountMenu } from "./account-menu";

const { router, signOut, reportFailure } = vi.hoisted(() => ({
  router: { replace: vi.fn(), refresh: vi.fn() },
  signOut: vi.fn(),
  reportFailure: vi.fn().mockResolvedValue("err-test"),
}));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/lib/load-auth-client", () => ({ loadAuthClient: async () => ({ signOut }) }));
vi.mock("@/lib/browser-feedback", () => ({ reportBrowserFailure: reportFailure }));

const account = { name: "Ana", address: "ana@sideband.app", email: "ana@example.org" };
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
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

async function openMenu(compact = false) {
  await act(() => root.render(<AccountMenu account={account} compact={compact} />));
  const trigger = host.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!;
  await act(() => trigger.click());
  return trigger;
}

function menuButton(label: string) {
  const control = [...host.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]')]
    .find((button) => button.textContent === label);
  expect(control, label).toBeDefined();
  return control!;
}

it.each([false, true])("cierra el menú con Escape o al pulsar fuera (compact=%s)", async (compact) => {
  const trigger = await openMenu(compact);
  const menu = host.querySelector('[role="menu"]')!;
  await act(() => { menu.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })); });
  expect(trigger.getAttribute("aria-expanded")).toBe("true");
  await act(() => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
  expect(host.querySelector('[role="menu"]')).toBeNull();
  await act(() => trigger.click());
  await act(() => { document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })); });
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
});

it.each([["Perfil", "/profile"], ["Agentes conectados", "/agents"]])(
  "cierra el menú al elegir %s", async (label, href) => {
    const trigger = await openMenu();
    const link = host.querySelector<HTMLAnchorElement>(`a[role="menuitem"][href="${href}"]`)!;
    expect(link.textContent).toBe(label);
    link.addEventListener("click", (event) => event.preventDefault(), { once: true });
    await act(() => link.click());
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  },
);

it("confirma temporalmente la copia de la dirección Sideband", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const write = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
  await openMenu();
  const copy = menuButton("Copiar dirección");
  await act(() => copy.click());
  expect(write).toHaveBeenCalledWith(account.address);
  expect(copy.textContent).toBe("Dirección copiada");
  await act(() => { vi.runOnlyPendingTimers(); });
  expect(copy.textContent).toBe("Copiar dirección");
});

it.each(["denegado", "ausente"])("ofrece copia manual con el portapapeles %s", async (reason) => {
  if (reason === "denegado") {
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("denegado"));
  } else {
    vi.stubGlobal("navigator", {});
  }
  await openMenu(true);
  const copy = menuButton("Copiar dirección");
  await act(() => copy.click());
  expect(copy.textContent).toBe("Copiar dirección");
  expect(host.querySelector('[role="status"]')?.textContent).toContain(account.address);
  if (reason === "denegado") expect(reportFailure).toHaveBeenCalledWith("copy_address");
});

it("espera el cierre de sesión antes de volver al acceso", async () => {
  const pending = Promise.withResolvers<void>();
  signOut.mockReturnValueOnce(pending.promise);
  await openMenu();
  const leave = menuButton("Cerrar sesión");
  await act(() => leave.click());
  expect(leave.disabled).toBe(true);
  await act(() => leave.click());
  expect(signOut).toHaveBeenCalledTimes(1);
  expect(router.replace).not.toHaveBeenCalled();
  await act(() => pending.resolve());
  expect(router.replace).toHaveBeenCalledWith("/sign-in");
  expect(router.refresh).toHaveBeenCalledOnce();
});
