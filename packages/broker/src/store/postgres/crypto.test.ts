import { describe, expect, it } from "vitest";
import { createWakeCodec } from "./crypto.js";

describe("wake secret storage", () => {
  it("binds a stored secret to its user and agent", () => {
    const codec = createWakeCodec(Buffer.alloc(32, 1).toString("base64"));
    const identity = { userId: "alice", agentId: "agent" };
    const target = { kind: "standard_webhook", url: "https://example.com", secret: "whsec_fixture-secret-value" } as const;
    const stored = codec.encode(target, identity);

    expect(codec.decode({ ...identity, ...stored })).toEqual(target);
    for (const changed of [
      { userId: "bob" },
      { agentId: "other-agent" },
    ]) {
      expect(() => codec.decode({ ...identity, ...stored, ...changed })).toThrow(
        "No se pudo leer la configuración de aviso.",
      );
    }
  });
});
