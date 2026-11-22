// @vitest-environment happy-dom
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";

import AuthLayout from "./layout";

it("mantiene el nombre Sideband fuera del contenido oculto a lectores de pantalla", () => {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(<AuthLayout>{null}</AuthLayout>);
  for (const hidden of host.querySelectorAll('[aria-hidden="true"], [hidden]')) {
    hidden.remove();
  }

  expect(host.textContent).toContain("Sideband");
});
