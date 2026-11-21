// Prueba de aislamiento del POC con solicitudes concurrentes entre usuarios de ejemplo.
import assert from "node:assert/strict";
import { startPoc } from "./server.mjs";

const poc = await startPoc();
try {
  const users = ["sol@example.test", "luna@example.test", "mar@example.test"];
  const [sol, luna, mar] = users;
  const clients = Object.fromEntries(await Promise.all(users.map(async (user) => [user, await poc.connect(user)])));
  const pairs = [[sol, luna], [sol, mar], [luna, mar], [mar, luna]];
  const messages = await Promise.all(Array.from({ length: 60 }, async (_, index) => {
    const [from, to] = pairs[index % pairs.length];
    const question = `Pregunta de ejemplo ${index}`;
    const ask = await clients[from]("sideband_ask", { to, tool: "pregunta", question });
    assert.equal(ask.decision, "pending");
    return { from, to, question, id: ask.request_id };
  }));

  await Promise.all(users.map(async (user) => {
    const { solicitudes } = await clients[user]("sideband_inbox");
    const expected = messages.filter(({ to }) => to === user);
    assert.deepEqual(
      new Set(solicitudes.map(({ request_id }) => request_id)),
      new Set(expected.map(({ id }) => id)),
    );
    for (const item of solicitudes) {
      const expectedMessage = expected.find(({ id }) => id === item.request_id);
      assert.equal(item.from, expectedMessage.from);
      assert.equal(item.mensaje_del_remitente.texto, expectedMessage.question);
    }
    await Promise.all(solicitudes.map(async ({ request_id, nonce }) => {
      const receipt = await clients[user]("sideband_reply", { request_id, nonce, respuesta: `Respuesta de ${user} a ${request_id}` });
      assert.equal(receipt.ok, true);
    }));
  }));

  await Promise.all(messages.map(async ({ from, to, id }) => {
    const result = await clients[from]("sideband_check", { request_id: id });
    assert.equal(result.final, true);
    assert.equal(result.result.respuesta, `Respuesta de ${to} a ${id}`);
  }));

  console.log(`Aislamiento verificado para ${messages.length} solicitudes.`);
} finally {
  await poc.close();
}
