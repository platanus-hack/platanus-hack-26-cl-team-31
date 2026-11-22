// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import { Segmented } from "./sliding";

it("marca la vista elegida como actual mientras carga la navegación", async ({ onTestFinished }) => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  const root = createRoot(host);
  onTestFinished(async () => {
    await act(() => root.unmount());
    vi.unstubAllGlobals();
  });

  const items = [
    { key: "contactos", href: "/contacts", label: "Contactos", active: true },
    { key: "solicitudes", href: "/contacts?vista=solicitudes", label: "Solicitudes", active: false },
  ];
  await act(() => root.render(<Segmented label="Vistas de contactos" items={items} />));
  const current = () => Array.from(host.querySelectorAll('a[aria-current="page"]'), link => link.textContent);
  expect(current()).toEqual(["Contactos"]);

  const solicitudes = host.querySelector<HTMLAnchorElement>('a[href="/contacts?vista=solicitudes"]')!;
  solicitudes.addEventListener("click", event => event.preventDefault(), { once: true });
  await act(() => solicitudes.click());
  expect(current()).toEqual(["Solicitudes"]);
});
