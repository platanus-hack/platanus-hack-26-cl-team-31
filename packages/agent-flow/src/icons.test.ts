import { expect, it } from "vitest";
import { iconFor } from "./icons.js";

it("muestra el icono de webhook aunque el agente se llame Claude Code", () => {
  expect(iconFor({
    id: "agent:ana:claude",
    role: "agent",
    owner: { key: "ana", label: "Ana" },
    label: "Claude Code",
    channel: "Webhook",
  })).toBe("hook");
});
