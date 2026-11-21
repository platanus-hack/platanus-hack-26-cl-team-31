import { randomUUID } from "node:crypto";
import { describe, expect, test } from "vitest";
import { enabled, grantTo, seedAgents } from "./fixtures.js";

describe.skipIf(!enabled)("Denegaciones y solicitudes a uno mismo", () => {
  test("sin un grant para esa tool, la solicitud se deniega sin avisar al destinatario", async () => {
    const { ownerPort, agents: [sender, recipient] } = await seedAgents("blocks", 2);
    if (!sender || !recipient) throw new Error("Faltan agentes de prueba.");

    await grantTo(ownerPort, recipient.owner, [sender.address], "availability");
    const question = { tool: "question", args: { text: "¿Puedes compartir el dato de prueba?", category: "general" } } as const;

    const domain = recipient.address.split("@")[1];
    const unclaimed = `e2e-${randomUUID().slice(0, 23)}@${domain}`;
    for (const denied of [
      await sender.agent.ask({ ...question, to: recipient.address }),
      await sender.agent.ask({ to: recipient.address, tool: "profile", args: {} }),
      await sender.agent.ask({ ...question, to: unclaimed }),
    ]) {
      expect(denied).toEqual({
        requestId: expect.any(String), to: expect.any(String), tool: expect.any(String), expiresAt: expect.any(String),
        final: true, decision: "deny", signature: expect.stringMatching(/^[\w-]{86}$/),
      });
      expect(await sender.agent.check(denied.requestId)).toEqual(denied);
    }

    await expect(sender.agent.ask({ ...question, to: sender.address })).rejects.toMatchObject({ code: "invalid_input" });
    expect(await sender.agent.inbox()).toEqual([]);
    expect(await recipient.agent.inbox()).toEqual([]);
    expect(await ownerPort.pending(recipient.owner)).toEqual([]);
  }, 30_000);
});
