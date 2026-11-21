import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

import { OwnerProfile } from "./owner-profile";

const { state, recordError } = vi.hoisted(() => ({ state: vi.fn(), recordError: vi.fn(() => "err-test") }));
vi.mock("@/lib/auth-owner", () => ({
  getOwnerAccount: async () => ({
    user: { id: "owner-1", name: "Ana", email: "ana@example.org", emailVerified: true, createdAt: new Date("2026-11-21") },
    address: "ana@sideband.app", displayName: "Ana M.",
  }),
}));
vi.mock("@/lib/whatsapp/runtime", () => ({ whatsappStore: () => ({ state }) }));
vi.mock("@/lib/telemetry", () => ({ getTelemetry: () => ({ error: recordError }) }));

it("muestra el perfil en una tabla con el teléfono confirmado del titular", async () => {
  state.mockResolvedValueOnce({ linked: "+56900000001" });
  const html = renderToStaticMarkup(await OwnerProfile());
  expect(state).toHaveBeenCalledWith("owner-1");
  for (const value of ["<table", 'scope="row"', "Ana M.", "ana@example.org", "verificado", "ana@sideband.app", "+56900000001", "Sin foto", "2026-11-21"]) {
    expect(html).toContain(value);
  }
});

it("oculta el teléfono pendiente de confirmar y conserva el perfil si falla la consulta", async () => {
  state.mockResolvedValueOnce({ linked: null, phone: "+56900000002", id: "pairing-id" });
  const pending = renderToStaticMarkup(await OwnerProfile());
  expect(pending).toContain("Sin vincular");
  expect(pending).not.toContain("+56900000002");
  expect(pending).not.toContain("pairing-id");

  state.mockRejectedValueOnce(new Error("db"));
  const unavailable = renderToStaticMarkup(await OwnerProfile());
  expect(unavailable).toContain("ana@sideband.app");
  expect(unavailable).toContain("err-test");
  expect(unavailable).not.toContain("Sin vincular");
});
