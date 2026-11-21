import { describe, expect, test } from "vitest";
import { enabled, grantTo, seedAgents } from "./fixtures.js";

describe.skipIf(!enabled)("Aislamiento entre usuarios", () => {
  test("cada bandeja, nonce y respuesta pertenece a su solicitud", async () => {
    const count = Number(process.env.E2E_ISOLATION_COUNT ?? 80);
    if (!Number.isSafeInteger(count) || count < 2) {
      throw new Error("E2E_ISOLATION_COUNT debe ser un entero mayor o igual a 2.");
    }
    // Broker quotas are based on the user's identity. Leave room below 30 asks per minute.
    const { ownerPort, agents } = await seedAgents("isolation", Math.max(3, Math.ceil(count / 28)));
    for (const recipient of agents) {
      const senders = agents.filter((agent) => agent !== recipient).map(({ address }) => address);
      await grantTo(ownerPort, recipient.owner, senders, "general");
    }

    const messages = await Promise.all(Array.from({ length: count }, async (_, index) => {
      const from = agents[index % agents.length]!;
      const offset = Math.floor(index / agents.length) % 2 + 1;
      const to = agents[(index + offset) % agents.length]!;
      const text = `Pregunta de aislamiento ${index} de ${from.address} a ${to.address}`;
      const pending = await from.agent.ask({ to: to.address, tool: "question", args: { text, category: "general" } });
      expect(pending).toMatchObject({ final: false, waitingFor: "agent" });
      return { from, to, text, requestId: pending.requestId, answer: `Respuesta de prueba número ${index}.` };
    }));
    expect(new Set(messages.map(({ requestId }) => requestId)).size).toBe(count);

    const deliveries = (await Promise.all(agents.map(async (recipient) => {
      const expected = new Map(messages.filter(({ to }) => to === recipient).map((message) => [message.requestId, message]));
      const items = await recipient.agent.inbox();
      expect(items.map(({ requestId }) => requestId).sort()).toEqual([...expected.keys()].sort());
      return items.map((item) => {
        const message = expected.get(item.requestId)!;
        expect(item).toMatchObject({
          requestId: message.requestId, from: message.from.address, args: { text: message.text },
          senderMessage: { text: message.text, trusted: false },
        });
        return { message, nonce: item.nonce };
      });
    }))).flat();

    const first = deliveries[0]!;
    const second = deliveries.find(({ message }) => message.requestId !== first.message.requestId)!;
    await expect(first.message.to.agent.reply({
      requestId: first.message.requestId, nonce: second.nonce, outcome: "answered",
      result: { answer: second.message.answer },
    })).rejects.toMatchObject({ code: "forbidden" });

    await Promise.all(deliveries.map(async ({ message, nonce }) => {
      const { requestId, to, from, answer } = message;
      await expect(from.agent.reply({
        requestId, nonce, outcome: "answered", result: { answer },
      })).rejects.toMatchObject({ code: "not_found" });
      expect(await to.agent.reply({ requestId, nonce, outcome: "answered", result: { answer } })).toMatchObject({
        requestId, status: "answered", deliveredFields: ["answer"], droppedFields: [],
      });
    }));

    await Promise.all(messages.map(async ({ from, to, requestId, answer }) => {
      // Each answer is unique per request, even when the same pair exchanges multiple messages.
      expect(await from.agent.check(requestId)).toMatchObject({
        requestId, to: to.address, final: true, decision: "allow", result: { answer },
      });
      await expect(to.agent.check(requestId)).rejects.toMatchObject({ code: "not_found" });
    }));
    expect(await Promise.all(agents.map(({ agent }) => agent.inbox()))).toEqual(agents.map(() => []));
  }, 90_000);
});
