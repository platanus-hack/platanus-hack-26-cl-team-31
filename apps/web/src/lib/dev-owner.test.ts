import { expect, it } from "vitest";

import { devOwnerEmail } from "./dev-owner";

it("conserva el correo del titular de prueba cuando su nombre lleva tilde", () => {
  expect(devOwnerEmail("Ana Pérez")).toBe("ana-perez@sideband.local");
});
