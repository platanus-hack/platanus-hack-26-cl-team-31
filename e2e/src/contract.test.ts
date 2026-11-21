import { createHmac, randomUUID } from "node:crypto";
import { WAKE_EVENT } from "@team-31/protocol";
import { describe, expect, onTestFinished, test } from "vitest";
import { runCommand } from "../../apps/web/src/lib/whatsapp/commands.js";
import { startFakeReceivers } from "./fake-receivers.js";
import { enabled, grantTo, inboxItem, seedAgents } from "./fixtures.js";

describe.skipIf(!enabled)("Contrato MCP", () => {
  test("disponibilidad filtrada, denegación sin permiso y outcomes del agente", async () => {
    const { ownerPort, agents: [sender, recipient, unknown] } = await seedAgents("contract", 3);
    if (!sender || !recipient || !unknown) throw new Error("Faltan agentes de prueba.");
    await grantTo(ownerPort, recipient.owner, [sender.address], "availability");
    await grantTo(ownerPort, recipient.owner, [sender.address], "general");

    const availability = {
      to: recipient.address, tool: "availability",
      args: { date: "2099-06-01", start: "10:00", durationMinutes: 30, timezone: "UTC" },
    } as const;
    const pending = await sender.agent.ask(availability);
    expect(pending).toMatchObject({ final: false, decision: "pending", waitingFor: "agent" });
    const item = await inboxItem(recipient.agent, pending.requestId);
    expect(item).toMatchObject({
      from: sender.address, args: availability.args, allowedFields: ["available"],
      senderMessage: { text: "", trusted: false },
      ownerAuthorization: { verifiedBy: "broker" },
    });
    const answer = { requestId: item.requestId, nonce: item.nonce, outcome: "answered" as const,
      result: { available: true, freeSlots: ["10:00-12:00"], note: "Nota privada de prueba" } };
    expect(await recipient.agent.reply(answer)).toMatchObject({
      status: "answered", deliveredFields: ["available"], droppedFields: expect.arrayContaining(["freeSlots", "note"]),
    });
    const filtered = await sender.agent.check(pending.requestId);
    expect(filtered).toMatchObject({
      final: true, decision: "allow", outcome: "answered", result: { available: true },
      signature: expect.stringMatching(/^[\w-]{86}$/),
    });
    expect(filtered.decision === "allow" && filtered.result).toEqual({ available: true });
    await expect(recipient.agent.reply(answer)).rejects.toMatchObject({ code: "conflict" });
    expect(await sender.agent.check(pending.requestId)).toEqual(filtered);

    expect(await unknown.agent.ask(availability)).toMatchObject({ final: true, decision: "deny" });
    expect(await recipient.agent.inbox()).toEqual([]);
    expect(await ownerPort.pending(recipient.owner)).toEqual([]);

    const granted = await ownerPort.setGrant(recipient.owner, { grantee: unknown.address, category: "availability" });
    const empty = await unknown.agent.ask(availability);
    const emptyItem = await inboxItem(recipient.agent, empty.requestId);
    const internalReason = "Nota interna de prueba";
    expect(await recipient.agent.reply({
      requestId: emptyItem.requestId, nonce: emptyItem.nonce, outcome: "no_data", internalReason,
    })).toMatchObject({ status: "no_data" });
    const noData = await unknown.agent.check(empty.requestId);
    expect(noData).toMatchObject({
      final: true, decision: "unanswered", outcome: "no_data", signature: expect.stringMatching(/^[\w-]{86}$/),
    });
    expect(JSON.stringify(noData)).not.toContain(internalReason);
    await ownerPort.revokeGrant(recipient.owner, granted.id);
    expect(await unknown.agent.ask(availability)).toMatchObject({ final: true, decision: "deny" });

    const text = "¿Podemos revisar el proyecto de prueba mañana?";
    const question = { to: recipient.address, tool: "question", args: { text, category: "general" } } as const;
    const escalation = await sender.agent.ask(question);
    const questionItem = await inboxItem(recipient.agent, escalation.requestId);
    expect(questionItem.senderMessage).toEqual({ text, trusted: false });
    expect(await recipient.agent.reply({
      requestId: questionItem.requestId, nonce: questionItem.nonce, outcome: "needs_owner",
    })).toMatchObject({ status: "awaiting_owner" });
    expect(await sender.agent.check(escalation.requestId)).toMatchObject({
      final: false, waitingFor: "owner", expiresAt: expect.any(String),
    });
    expect(await ownerPort.pending(recipient.owner)).toContainEqual(expect.objectContaining({
      requestId: escalation.requestId, escalated: true,
    }));
    await ownerPort.decide(recipient.owner, escalation.requestId, { kind: "answer", result: { answer: "Sí, revisemos." } });
    expect(await sender.agent.check(escalation.requestId)).toMatchObject({
      final: true, decision: "allow", result: { answer: "Sí, revisemos." },
    });

    const declined = await sender.agent.ask(question);
    const declinedItem = await inboxItem(recipient.agent, declined.requestId);
    expect(await recipient.agent.reply({
      requestId: declinedItem.requestId, nonce: declinedItem.nonce, outcome: "declined", internalReason,
    })).toMatchObject({ status: "declined" });
    expect(await sender.agent.check(declined.requestId)).toEqual({
      requestId: declined.requestId, to: recipient.address, tool: "question", expiresAt: declined.expiresAt,
      final: true, decision: "deny", signature: expect.stringMatching(/^[\w-]{86}$/),
    });
  }, 60_000);

  test("WhatsApp recupera por estado la respuesta del segundo agente", async () => {
    const { ownerPort, agents: [sender, recipient] } = await seedAgents("contract", 2);
    if (!sender || !recipient) throw new Error("Faltan agentes de prueba.");
    await grantTo(ownerPort, recipient.owner, [sender.address], "general");

    // Use the same command handler as the signed webhook, with no call to Kapso.
    let requestId: string | undefined;
    const command = (text: string) => runCommand(ownerPort, sender.owner, text, (_action, view) => {
      requestId = view.requestId;
    });
    const question = "¿Puedes jugar el sábado?";
    const pending = `Le pregunté a ${recipient.address}. Te aviso apenas responda.`;
    expect(await command(`Pregunta a ${recipient.address} ${question}`)).toBe(pending);
    if (!requestId) throw new Error("WhatsApp no creó la solicitud.");
    const check = `estado ${requestId}`;
    const item = await inboxItem(recipient.agent, requestId);
    expect(item.senderMessage.text).toBe(question);
    expect(await command(check)).toBe(pending);

    const answer = "Sí, puedo jugar a las diez.";
    expect(await recipient.agent.reply({
      requestId: item.requestId, nonce: item.nonce, outcome: "answered", result: { answer },
    })).toMatchObject({ status: "answered", deliveredFields: ["answer"] });
    expect(await sender.agent.check(item.requestId)).toMatchObject({ decision: "allow", result: { answer } });
    const expected = `Respuesta de ${recipient.address}:\n${answer}\n\nSolicitud: ${item.requestId}`;
    expect(await command(check)).toBe(expected);
    expect(await command("estado")).toBe(expected);
  });

  test("OpenClaw, Grok Bot y MCP Events reciben avisos sin contenido de la pregunta", async () => {
    const { ownerPort, agents: [sender, recipient] } = await seedAgents("contract", 2);
    if (!sender || !recipient) throw new Error("Faltan agentes de prueba.");
    const receiver = await startFakeReceivers();
    onTestFinished(receiver.close);
    const setWake = (target: Parameters<typeof ownerPort.setWake>[2]) =>
      ownerPort.setWake(recipient.owner, recipient.agentId, target);
    onTestFinished(() => setWake({ kind: "none" }));
    await grantTo(ownerPort, recipient.owner, [sender.address], "general");

    const verifyNotice = async (kind: "openclaw_hooks" | "grokbot_routine" | "mcp_events") => {
      const text = `Contenido reservado de la prueba ${randomUUID()}`;
      const purpose = "Propósito reservado para la bandeja";
      const ask = await sender.agent.ask({ to: recipient.address, tool: "question", args: { text, category: "general" }, purpose });
      expect(ask).toMatchObject({ final: false, waitingFor: "agent" });
      await expect.poll(() => receiver.attempts.filter(({ requestId }) => requestId === ask.requestId), {
        timeout: 8_000,
      }).toEqual([{ requestId: ask.requestId, kind }]);
      expect(receiver.rejections).toEqual([]);
      const item = await inboxItem(recipient.agent, ask.requestId);
      expect(item.senderMessage).toEqual({ text, purpose, trusted: false });
      await recipient.agent.reply({ requestId: item.requestId, nonce: item.nonce, outcome: "no_data" });
    };

    await setWake(receiver.openClaw);
    await verifyNotice("openclaw_hooks");
    await setWake(receiver.grokBot);
    await verifyNotice("grokbot_routine");
    const subscription = await recipient.agent.subscribe(receiver.events.url, receiver.events.secret);
    await verifyNotice("mcp_events");
    await recipient.agent.unsubscribe(subscription.id);
    expect(await ownerPort.agents(recipient.owner)).toContainEqual(expect.objectContaining({
      agentId: recipient.agentId, wakeKind: "none",
    }));
  }, 40_000);

  test("el receptor rechaza firmas inválidas y avisos firmados con texto de la pregunta", async () => {
    const receiver = await startFakeReceivers();
    onTestFinished(receiver.close);
    const requestId = randomUUID();
    const id = `evt_${requestId}`;
    const timestamp = String(Math.floor(Date.now() / 1000));
    const key = Buffer.from(receiver.failingWebhook.secret.slice("whsec_".length), "base64");
    const clean = JSON.stringify({ event: WAKE_EVENT, requestId });
    const leaked = JSON.stringify({ event: WAKE_EVENT, requestId, text: "¿Texto privado de prueba?" });
    const post = (body: string, signedBody: string) => {
      const signature = createHmac("sha256", key).update(`${id}.${timestamp}.${signedBody}`).digest("base64");
      return fetch(receiver.failingWebhook.url, {
        method: "POST", body, headers: {
          "webhook-id": id, "webhook-timestamp": timestamp, "webhook-signature": `v1,${signature}`,
        },
      });
    };
    expect((await post(clean, leaked)).status).toBe(400);
    expect((await post(leaked, leaked)).status).toBe(400);
    expect((await post(clean, clean)).status).toBe(500);
    expect(receiver.attempts).toEqual([{ requestId, kind: "standard_webhook" }]);
  });
});
