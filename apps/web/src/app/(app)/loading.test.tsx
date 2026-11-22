// @vitest-environment happy-dom
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";

import Loading from "./loading";

it("expone un único estado de carga para el inicio", () => {
  const container = document.createElement("div");
  container.innerHTML = renderToStaticMarkup(<Loading />);

  const statuses = container.querySelectorAll('[role="status"]');
  expect(Array.from(statuses, (status) => status.getAttribute("aria-label"))).toEqual(["Cargando inicio"]);
});
