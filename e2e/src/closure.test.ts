import { describe, expect, onTestFinished, test } from "vitest";
import { startFakeReceivers } from "./fake-receivers.js";
import { enabled, inboxItem, rulesFor, seedAgents } from "./fixtures.js";

describe.skipIf(!enabled)("Cierre de solicitudes por el worker", () => {
  test("vence una sin respuesta y cierra otra tras tres avisos HTTP 500", async () => {
    const { ownerPort, agents: [sender, recipient] } = await seedAgents("closure", 2);
    if (!sender || !recipient) throw new Error("Faltan agentes de prueba.");
    await ownerPort.setRules(recipient.owner, rulesFor([sender.address], "question", ["answer"]));

    const question = {
      to: recipient.address, tool: "question",
      args: { text: "¿Está lista la revisión de prueba?" }, purpose: "Verificar el cierre del worker",
    } as const;
    const expired = await sender.agent.ask(question);
    expect(expired).toMatchObject({ final: false, waitingFor: "agent" });
    const staleItem = await inboxItem(recipient.agent, expired.requestId);
    const waitForExpiry = Date.parse(expired.expiresAt) - Date.now();
    expect(waitForExpiry, "Configura REQUEST_TTL_SECONDS=20 en el broker de pruebas.").toBeLessThan(40_000);
    await expect.poll(() => sender.agent.check(expired.requestId), { timeout: 45_000, interval: 400 }).toMatchObject({
      final: true, decision: "unanswered", outcome: "expired", signature: expect.stringMatching(/^[\w-]{86}$/),
    });
    expect(Date.now()).toBeGreaterThanOrEqual(Date.parse(expired.expiresAt));
    expect(await recipient.agent.inbox()).toEqual([]);
    await expect(recipient.agent.reply({
      requestId: staleItem.requestId, nonce: staleItem.nonce, outcome: "no_data",
    })).rejects.toMatchObject({ code: "conflict" });

    const receiver = await startFakeReceivers();
    onTestFinished(receiver.close);
    onTestFinished(() => ownerPort.setWake(recipient.owner, recipient.agentId, { kind: "none" }));
    await ownerPort.setWake(recipient.owner, recipient.agentId, receiver.failingWebhook);
    const failed = await sender.agent.ask(question);
    expect(failed).toMatchObject({ final: false, waitingFor: "agent" });
    await expect.poll(() => sender.agent.check(failed.requestId), {
      timeout: 10_000, interval: 150,
      message: "El broker necesita WAKE_ALLOW_INSECURE=1 y WAKE_RETRY_DELAYS_MS=0,0.",
    }).toMatchObject({
      final: true, decision: "unanswered", outcome: "delivery_failed", signature: expect.stringMatching(/^[\w-]{86}$/),
    });
    expect(receiver.rejections).toEqual([]);
    expect(receiver.attempts).toEqual(Array.from({ length: 3 }, () => ({
      requestId: failed.requestId, kind: "standard_webhook",
    })));
    expect(await recipient.agent.inbox()).toEqual([]);

    const activity = await ownerPort.activity(recipient.owner);
    for (const [requestId, status] of [[expired.requestId, "expired"], [failed.requestId, "delivery_failed"]] as const) {
      const entry = activity.find((item) => item.requestId === requestId);
      expect(entry).toMatchObject({ status, outcome: status });
      expect(entry?.events.filter(({ kind }) => kind === "delivery")).toEqual([
        { kind: "delivery", status, at: expect.any(String) },
      ]);
    }
  }, 65_000);
});
