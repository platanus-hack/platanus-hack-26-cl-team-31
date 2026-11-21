import { afterEach, expect, it, vi } from "vitest";
import { getOwnerAccount } from "./auth-owner";

const { me, identify } = vi.hoisted(() => ({ me: vi.fn(), identify: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("./auth", () => ({ requireSession: async () => ({ user: { id: "session-user" } }) }));
vi.mock("./broker", () => ({ ownerClient: () => ({ me }) }));
vi.mock("./telemetry", () => ({ getTelemetry: () => ({ identify }) }));

afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

it("reads the account with the identity of the active session", async () => {
  vi.stubEnv("WEB_SERVICE_PRIVATE_KEY", "configured");
  me.mockResolvedValue({ address: "ana@sideband.app", displayName: "Ana" });
  expect(await getOwnerAccount()).toEqual({ user: { id: "session-user" }, address: "ana@sideband.app", displayName: "Ana" });
  expect(me).toHaveBeenCalledExactlyOnceWith({ userId: "session-user" });
  expect(identify).toHaveBeenCalledWith({ userId: "session-user" });
});

it("retains the session identity when the web service key is missing", async () => {
  vi.stubEnv("WEB_SERVICE_PRIVATE_KEY", "");
  expect(await getOwnerAccount()).toEqual({ user: { id: "session-user" }, address: undefined, displayName: undefined });
  expect(me).not.toHaveBeenCalled();
});
