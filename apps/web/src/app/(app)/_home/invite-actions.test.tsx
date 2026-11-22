// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { reportBrowserFailure } from "@/lib/browser-feedback";
import { InviteActions } from "./invite-actions";

vi.mock("@/lib/browser-feedback", () => ({ reportBrowserFailure: vi.fn().mockResolvedValue("err-test") }));

const url = "https://equipo.example.org/invite";
const invitation = { title: "Invitación a Sideband", url };
const shareLabel = "Compartir enlace…";
const copyLabel = "Copiar enlace";
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let trigger: HTMLButtonElement;

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(() => root.render(<InviteActions url={url} />));
  trigger = host.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!;
});

afterEach(async () => {
  await act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

async function choose(label: string) {
  await act(() => trigger.click());
  const action = Array.from(host.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
    .find((button) => button.textContent === label);
  expect(action, label).toBeDefined();
  await act(() => action!.click());
}

it("cierra el menú con Escape o al pulsar fuera y lo mantiene abierto al pulsar dentro", async () => {
  await act(() => trigger.click());
  const menu = host.querySelector('[role="menu"]')!;
  await act(() => { menu.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })); });
  expect(trigger.getAttribute("aria-expanded")).toBe("true");
  await act(() => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
  expect(host.querySelector('[role="menu"]')).toBeNull();
  await act(() => trigger.click());
  await act(() => { document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })); });
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
});

it("comparte la invitación una sola vez mientras el menú nativo está pendiente", async () => {
  const pending = Promise.withResolvers<void>();
  const share = vi.fn(() => pending.promise);
  const writeText = vi.fn();
  vi.stubGlobal("navigator", { share, clipboard: { writeText } });

  await choose(shareLabel);
  expect(share.mock.calls).toEqual([[invitation]]);
  expect(trigger.disabled).toBe(true);
  await act(() => trigger.click());
  expect(host.querySelector('[role="menu"]')).toBeNull();

  await act(() => pending.resolve());
  expect(trigger.disabled).toBe(false);
  expect(writeText).not.toHaveBeenCalled();
  expect(reportBrowserFailure).not.toHaveBeenCalled();
});

it.each(["share ausente", "canShare rechaza la invitación"])("copia el enlace cuando %s", async (reason) => {
  const share = vi.fn();
  const canShare = vi.fn(() => false);
  const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
  vi.stubGlobal("navigator", reason === "share ausente" ? { clipboard } : { share, canShare, clipboard });

  await choose(shareLabel);
  if (reason !== "share ausente") expect(canShare).toHaveBeenCalledWith(invitation);
  expect(share).not.toHaveBeenCalled();
  expect(clipboard.writeText.mock.calls).toEqual([[url]]);
  expect(host.querySelector('[role="status"]')?.textContent).toBe("Enlace copiado.");
  expect(trigger.disabled).toBe(false);
});

it("copia directamente aunque se pueda compartir y retira la confirmación", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const share = vi.fn();
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { share, clipboard: { writeText } });

  await choose(copyLabel);
  expect(writeText).toHaveBeenCalledWith(url);
  expect(share).not.toHaveBeenCalled();
  expect(host.querySelector('[role="status"]')?.textContent).toBe("Enlace copiado.");
  await act(() => { vi.advanceTimersByTime(2000); });
  expect(host.querySelector('[role="status"]')).toBeNull();
});

it.each(["ausente", "denegado"])("permite seleccionar el enlace con el portapapeles %s", async (reason) => {
  const clipboard = { writeText: vi.fn().mockRejectedValue(new Error("denegado")) };
  vi.stubGlobal("navigator", reason === "ausente" ? {} : { clipboard });

  await choose(copyLabel);
  const field = host.querySelector<HTMLInputElement>('input[aria-label="Enlace de invitación"]')!;
  expect(field.value).toBe(url);
  await act(() => field.focus());
  expect([field.selectionStart, field.selectionEnd]).toEqual([0, url.length]);
  expect(vi.mocked(reportBrowserFailure).mock.calls).toEqual(reason === "ausente" ? [] : [["copy_invite"]]);
});

it("permite volver a invitar tras cancelar el diálogo nativo", async () => {
  const share = vi.fn().mockRejectedValueOnce(new DOMException("Cancelado", "AbortError"))
    .mockResolvedValueOnce(undefined);
  const writeText = vi.fn();
  vi.stubGlobal("navigator", { share, canShare: () => true, clipboard: { writeText } });

  await choose(shareLabel);
  expect(host.querySelector('[role="alert"], [role="status"]')).toBeNull();
  expect(writeText).not.toHaveBeenCalled();
  expect(reportBrowserFailure).not.toHaveBeenCalled();
  await choose(shareLabel);
  expect(share).toHaveBeenCalledTimes(2);
});

it("registra el fallo al compartir y permite recuperarse copiando el enlace", async () => {
  const share = vi.fn().mockRejectedValue(new Error("falló"));
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { share, clipboard: { writeText } });

  await choose(shareLabel);
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Puedes copiar el enlace");
  expect(vi.mocked(reportBrowserFailure).mock.calls).toEqual([["share_invite"]]);
  await choose(copyLabel);
  expect(writeText).toHaveBeenCalledWith(url);
  expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(host.querySelector('[role="status"]')?.textContent).toBe("Enlace copiado.");
});
