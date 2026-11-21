// Prueba del contrato del POC por MCP con un servidor local y usuarios de ejemplo.
import assert from "node:assert/strict";
import { startPoc } from "./server.mjs";
import { watchInbox } from "./nexo-watch.mjs";

const poc = await startPoc();
try {
  const target = "luna@example.test";
  const sol = await poc.connect("sol@example.test");
  const luna = await poc.connect(target);
  const rio = await poc.connect("rio@example.test");

  const profile = await sol("nexo_ask", { to: target, tool: "perfil", question: "¿Quién es Luna?" });
  assert.equal(profile.decision, "allow");
  assert.equal(profile.result.perfil, "Administra el calendario de ejemplo.");
  assert.ok(profile.response_sig);

  const ask = await sol("nexo_ask", { to: target, tool: "disponibilidad", question: "¿Puede mañana a las 10:00?" });
  assert.equal(ask.decision, "pending");
  const watcher = watchInbox(luna);
  const notice = await watcher.next();
  await watcher.return();
  assert.deepEqual(notice.value, { requestId: ask.request_id });

  const { solicitudes } = await luna("nexo_inbox");
  const item = solicitudes.find((entry) => entry.request_id === ask.request_id);
  assert.ok(item?.nonce);
  assert.equal(item.mensaje_del_remitente.confiable, false);

  const receipt = await luna("nexo_reply", {
    request_id: ask.request_id,
    nonce: item.nonce,
    disponible: true,
    bloques_libres: ["10:00-12:00"],
    nota: "Nota de prueba",
  });
  assert.equal(receipt.ok, true);
  assert.deepEqual(receipt.campos_eliminados, ["nota"]);

  const result = await sol("nexo_check", { request_id: ask.request_id });
  assert.equal(result.final, true);
  assert.equal(result.decision, "allow");
  assert.deepEqual(result.result, { disponible: true, bloques_libres: ["10:00-12:00"] });
  assert.ok(result.response_sig);

  const repeat = await luna("nexo_reply", { request_id: ask.request_id, nonce: item.nonce, disponible: false });
  assert.equal(repeat.ok, false);

  const fromUnknown = await rio("nexo_ask", { to: target, tool: "disponibilidad", question: "¿Cuándo está libre?" });
  assert.equal(fromUnknown.status, "esperando_aprobacion");

  const askNoData = await sol("nexo_ask", { to: target, tool: "disponibilidad", question: "¿Puede el lunes a las 9:00?" });
  const noDataItem = (await luna("nexo_inbox")).solicitudes.find((entry) => entry.request_id === askNoData.request_id);
  await luna("nexo_reply", { request_id: askNoData.request_id, nonce: noDataItem.nonce, outcome: "no_data", motivo: "Nota interna" });
  const noDataResult = await sol("nexo_check", { request_id: askNoData.request_id });
  assert.equal(noDataResult.final, true);
  assert.equal(noDataResult.decision, "unanswered");
  assert.equal(noDataResult.outcome, "no_data");
  assert.ok(!JSON.stringify(noDataResult).includes("Nota interna"));

  const askOwner = await sol("nexo_ask", { to: target, tool: "pregunta", question: "¿Revisamos el proyecto mañana?" });
  const ownerItem = (await luna("nexo_inbox")).solicitudes.find((entry) => entry.request_id === askOwner.request_id);
  await luna("nexo_reply", { request_id: askOwner.request_id, nonce: ownerItem.nonce, outcome: "needs_owner" });
  const ownerResult = await sol("nexo_check", { request_id: askOwner.request_id });
  assert.equal(ownerResult.final, false);
  assert.equal(ownerResult.status, "esperando_al_dueno");
  assert.ok(ownerResult.expires_at);

  console.log("Contrato del POC verificado.");
} finally {
  await poc.close();
}
