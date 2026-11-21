import { expect, it, vi } from "vitest";
import { startDemoBroker } from "../src/demo-broker.mjs";
import { askContactOwner } from "../src/contact-runtime.mjs";

vi.mock("../src/contact-runtime.mjs", () => ({
  askContactOwner: vi.fn(async (_name, _interest, source) => ({ matches: source === "bob-fixture" })),
}));

it("resuelve el mismo interés por contacto y mantiene separadas las respuestas simultáneas", async () => {
  const demo = await startDemoBroker([
    { id: "bob", name: "Bob", source: "bob-fixture", allowsInterest: true },
    { id: "jane", name: "Jane", source: "jane-fixture", allowsInterest: true },
    { id: "luz", name: "Luz", source: "luz-fixture", allowsInterest: false },
  ]);
  try {
    const contacts = demo.listContacts();
    expect(contacts).toEqual([
      { name: "Bob", address: "bob@nexo.app" },
      { name: "Jane", address: "jane@nexo.app" },
      { name: "Luz", address: "luz@nexo.app" },
    ]);
    const responses = await Promise.all(contacts.map(async ({ address }) => {
      const { requestId } = await demo.ask(address, "interest_check", { interest: "cerámica" });
      return demo.result(requestId);
    }));
    expect(responses[0]).toMatchObject({ to: contacts[0].address, decision: "allow", result: { matches: true } });
    expect(responses[1]).toMatchObject({ to: contacts[1].address, decision: "allow", result: { matches: false } });
    expect(responses[2]).toMatchObject({ to: contacts[2].address, decision: "deny" });
    expect(responses[0].requestId).not.toBe(responses[1].requestId);

    const denied = await demo.ask(contacts[1].address, "question", { text: "¿Cuál es tu domicilio?" });
    expect(denied.decision).toBe("deny");
    await expect(demo.ask("eva@nexo.app", "interest_check", { interest: "cerámica" })).rejects.toThrow(/agenda/);
    expect(askContactOwner).toHaveBeenCalledTimes(2);
    expect(askContactOwner).toHaveBeenCalledWith("Jane", "cerámica", "jane-fixture");
    expect(askContactOwner).toHaveBeenCalledWith("Bob", "cerámica", "bob-fixture");
  } finally {
    demo.close();
  }
}, 30_000);
