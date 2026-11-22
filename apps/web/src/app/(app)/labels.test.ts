import { expect, it } from "vitest";

import { formatRelative } from "./labels";

it("muestra el vencimiento en minutos hasta que falta una hora", () => {
  const now = Date.parse("2026-11-21T12:00:00Z");
  const spanish = new Intl.RelativeTimeFormat("es", { numeric: "auto", style: "short" });

  expect(formatRelative("2026-11-21T12:59:00Z", now)).toBe(spanish.format(59, "minute"));
  expect(formatRelative("2026-11-21T13:00:00Z", now)).toBe(spanish.format(1, "hour"));
});
