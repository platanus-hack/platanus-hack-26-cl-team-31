// @vitest-environment happy-dom
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

import ProfilePage from "./page";

vi.mock("@/lib/auth-owner", () => ({
  getOwnerAccount: () => new Promise(() => {}),
}));

it("muestra el título y anuncia la carga mientras espera la cuenta del titular", () => {
  const view = document.createElement("div");
  view.innerHTML = renderToStaticMarkup(<ProfilePage />);

  expect(view.querySelector("h1")?.textContent).toBe("Perfil");
  expect(view.querySelector('[role="status"]')?.getAttribute("aria-label")).toBe("Cargando perfil");
});
