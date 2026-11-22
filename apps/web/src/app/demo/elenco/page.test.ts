import { afterEach, expect, it, vi } from "vitest";
import CastPage from "./page";

vi.mock("@/lib/broker", () => ({ ownerClient: vi.fn() }));

afterEach(() => vi.unstubAllEnvs());

it("oculta el elenco de demostración en producción", () => {
  vi.stubEnv("NODE_ENV", "production");
  expect(CastPage).toThrow(expect.objectContaining({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" }));
});
