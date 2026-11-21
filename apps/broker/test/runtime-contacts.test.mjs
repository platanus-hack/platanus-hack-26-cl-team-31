import { expect, it, vi } from "vitest";
import { startDemoBroker } from "../../../packages/broker/scripts/demo-broker.mjs";
import { askContactOwner } from "../../../packages/broker/scripts/contact-runtime.mjs";

vi.mock("../../../packages/broker/scripts/contact-runtime.mjs", () => ({
  askContactOwner: vi.fn(async (_name, _interest, source) => ({ matches: source === "bob-fixture" })),
}));

it("resuelve el mismo interés por contacto y mantiene separadas las respuestas simultáneas", async () => {
  const demo = await startDemoBroker("bob-fixture", "jane-fixture");
  try {
    const contacts = demo.listContacts();
    expect(contacts).toEqual([
      { name: "Bob", address: "bob@demo.local" },
      { name: "Jane", address: "jane@demo.local" },
    ]);
    const responses = await Promise.all(contacts.map(async ({ address }) => {
      const { requestId } = await demo.ask(address, "interest_check", { interest: "cerámica" });
      return demo.result(requestId);
    }));
    expect(responses[0]).toMatchObject({ to: contacts[0].address, decision: "allow", result: { matches: true } });
    expect(responses[1]).toMatchObject({ to: contacts[1].address, decision: "allow", result: { matches: false } });
    expect(responses[0].requestId).not.toBe(responses[1].requestId);

    const denied = await demo.ask(contacts[1].address, "question", { text: "¿Cuál es tu domicilio?" });
    expect(denied.decision).toBe("deny");
    await expect(demo.ask("eva@demo.local", "interest_check", { interest: "cerámica" })).rejects.toThrow(/agenda/);
    expect(askContactOwner).toHaveBeenCalledTimes(2);
    expect(askContactOwner).toHaveBeenCalledWith("Jane", "cerámica", "jane-fixture");
    expect(askContactOwner).toHaveBeenCalledWith("Bob", "cerámica", "bob-fixture");
  } finally {
    demo.close();
  }
});
