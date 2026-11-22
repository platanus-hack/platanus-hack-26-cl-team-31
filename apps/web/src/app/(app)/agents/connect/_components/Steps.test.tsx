// @vitest-environment happy-dom
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";

import { Step, Steps } from "./Steps";

it("incluye el número del paso al navegar por los encabezados del asistente", () => {
  const view = document.createElement("div");
  view.innerHTML = renderToStaticMarkup(
    <Steps>
      <Step number={2} title="Autorizar en Sideband">Revisa los permisos.</Step>
    </Steps>,
  );

  expect(view.querySelector("h2")?.textContent).toBe("Paso 2. Autorizar en Sideband");
});
