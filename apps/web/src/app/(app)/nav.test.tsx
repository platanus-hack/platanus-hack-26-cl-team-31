// @vitest-environment happy-dom
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

import { Navigation } from "./nav";

vi.mock("next/navigation", () => ({ usePathname: () => "/agents/connect" }));

it("marca solo Agentes como sección actual al conectar un agente", () => {
  const view = document.createElement("div");
  view.innerHTML = renderToStaticMarkup(<Navigation />);

  const current = view.querySelectorAll('a[aria-current="page"]');
  expect(Array.from(current, (link) => link.getAttribute("href"))).toEqual(["/agents"]);
});
