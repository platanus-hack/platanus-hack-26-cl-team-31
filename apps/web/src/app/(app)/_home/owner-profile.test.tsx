import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

import { OwnerProfile } from "./owner-profile";

vi.mock("@/lib/auth-owner", () => {
  const user = { id: "owner-1", name: "Ana", email: "ana@example.org", emailVerified: true, createdAt: new Date("2026-11-21") };
  return {
    getOwnerAccount: async () => ({ user, address: "ana@sideband.app", displayName: "Ana M." }),
  };
});

it("muestra el perfil en una tabla del titular", async () => {
  const html = renderToStaticMarkup(await OwnerProfile());
  for (const value of ["<table", 'scope="row"', "Ana M.", "ana@example.org", "verificado", "ana@sideband.app", "Sin foto", "2026-11-21"]) {
    expect(html).toContain(value);
  }
});
