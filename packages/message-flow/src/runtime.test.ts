import { silentTelemetry } from "@team-31/telemetry";
import { afterEach, expect, it, vi } from "vitest";
import { createClaudeInterpreter } from "./anthropic.js";
import { createPostgresTurnStore } from "./postgres.js";
import { createMessageRuntime } from "./runtime.js";
import type { InterpretMessage, TurnStore } from "./types.js";

vi.mock("./anthropic.js", () => ({ createClaudeInterpreter: vi.fn() }));
vi.mock("./postgres.js", () => ({ createPostgresTurnStore: vi.fn() }));

const telemetry = silentTelemetry("mcp");

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});

it.each([undefined, "   "])("deshabilita el flujo sin clave antes de abrir recursos", (key) => {
  vi.stubEnv("ANTHROPIC_API_KEY", key);
  vi.stubEnv("MESSAGE_FLOW_DATABASE_URL", undefined);
  vi.stubEnv("DATABASE_URL", undefined);

  expect(createMessageRuntime(telemetry)).toBeUndefined();
  expect(createClaudeInterpreter).not.toHaveBeenCalled();
  expect(createPostgresTurnStore).not.toHaveBeenCalled();
});

it("requiere un almacén cuando el canal tiene habilitada la interpretación", () => {
  vi.stubEnv("ANTHROPIC_API_KEY", "fixture-key");
  vi.stubEnv("MESSAGE_FLOW_DATABASE_URL", undefined);
  vi.stubEnv("DATABASE_URL", undefined);

  expect(() => createMessageRuntime(telemetry)).toThrow(/MESSAGE_FLOW_DATABASE_URL o DATABASE_URL/);
  expect(createPostgresTurnStore).not.toHaveBeenCalled();
});

it.each([
  { dedicated: "postgres://turns.invalid/turns", model: "modelo-elegido" },
  { dedicated: undefined, model: undefined },
])("elige la conexión y el modelo del canal ($dedicated, $model)", async ({ dedicated, model }) => {
  const shared = "postgres://shared.invalid/sideband";
  vi.stubEnv("ANTHROPIC_API_KEY", "  fixture-key  ");
  vi.stubEnv("DATABASE_URL", shared);
  vi.stubEnv("MESSAGE_FLOW_DATABASE_URL", dedicated);
  vi.stubEnv("MESSAGE_FLOW_MODEL", model);
  const interpret = vi.fn<InterpretMessage>().mockResolvedValue({ action: "contacts" });
  vi.mocked(createClaudeInterpreter).mockReturnValue(interpret);
  const run: TurnStore["run"] = (_owner, _continuationId, turn) =>
    turn({ id: "turn", continuationId: "turn", save: vi.fn() });
  const latestContinuation = vi.fn().mockResolvedValue("turn");
  const close = vi.fn().mockResolvedValue(undefined);
  vi.mocked(createPostgresTurnStore).mockReturnValue({ run, latestContinuation, close });

  const runtime = createMessageRuntime(telemetry)!;
  expect(createClaudeInterpreter).toHaveBeenCalledExactlyOnceWith({ apiKey: "fixture-key", model });
  expect(createPostgresTurnStore).toHaveBeenCalledExactlyOnceWith(dedicated ?? shared, telemetry);
  const directory = { contacts: [], circles: [] };
  const ops = { contacts: vi.fn().mockResolvedValue(directory), ask: vi.fn(), status: vi.fn() };
  const owner = { userId: "ana", binding: "whatsapp:fixture" };
  const reply = await runtime.handleMessage({ ...owner, ops }, { text: "Mis contactos" });
  expect(reply).toEqual({ kind: "contacts", data: directory });
  expect(await runtime.latestContinuation(owner.userId, owner.binding)).toBe("turn");
  expect(latestContinuation).toHaveBeenCalledExactlyOnceWith(owner.userId, owner.binding);
  await runtime.close();
  expect(close).toHaveBeenCalledOnce();
});
