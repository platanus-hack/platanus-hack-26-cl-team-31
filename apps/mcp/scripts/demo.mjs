import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fixtureArgs, group, minutes, slots } from "../../../scripts/coordination-fixture.mjs";

const { people, configDir } = fixtureArgs(process.argv.slice(2));
const sessions = new Map();

async function call(person, name, args = {}) {
  const result = await sessions.get(person).callTool({ name, arguments: args });
  assert.ok(!result.isError, `${person} · ${name}: ${result.content[0]?.text}`);
  return result.structuredContent ?? JSON.parse(result.content[0].text);
}

try {
  for (const person of [...people, "eva"]) {
    const config = JSON.parse(await readFile(join(configDir, `${person}.json`), "utf8"));
    const client = new Client({ name: `demo-${person}`, version: "1.0.0" });
    sessions.set(person, client);
    await client.connect(new StdioClientTransport(config.mcpServers.coordination));
  }
  const [organizer, target] = people;
  const catalog = await sessions.get(organizer).listTools();
  const names = catalog.tools.map(tool => tool.name);
  for (const name of ["availability_check", "group_permission", "interest_search", "meeting_propose", "meeting_decide"]) {
    assert.ok(names.includes(name), `Falta ${name} en el catálogo MCP.`);
  }
  const args = { recipient: target, group, minutes, slot: slots[1] };
  const free = await call(organizer, "availability_check", args);
  assert.equal(free.status, "available", "El demo requiere que Bob comparta disponibilidad con el grupo futbol.");
  const busy = await call(organizer, "availability_check", { ...args, slot: slots[0] });
  assert.equal(busy.status, "busy");
  assert.equal((await call("eva", "availability_check", args)).status, "not_shareable");
  const impersonation = await sessions.get("eva").callTool({
    name: "availability_check", arguments: { ...args, actor: organizer },
  });
  assert.equal(impersonation.isError, true);
  assert.match(impersonation.content[0].text, /HTTP 400/);
  console.log("Ana → Bob: ocupado a las 16:00, disponible a las 18:00. Eva → Bob: sin información compartible.");

  const publisher = people.at(-1);
  const publication = { interest: `fútbol demo ${randomUUID().slice(0, 8)}`, group };
  await call(publisher, "interest_publish", publication);
  try {
    const { entries } = await call(organizer, "interest_search", publication);
    assert.ok(entries.some(entry => entry.person === publisher));
    assert.deepEqual((await call("eva", "interest_search", publication)).entries, []);
    console.log(`Ana encuentra a ${publisher} al buscar su interés en fútbol. Eva queda fuera de la audiencia.`);
  } finally {
    await call(publisher, "interest_withdraw", publication);
  }

  await call(target, "group_permission", { group, can_share: false });
  try {
    assert.equal((await call(organizer, "availability_check", args)).status, "not_shareable");
    assert.equal((await call(organizer, "request_get", { request_id: free.request_id })).status, "not_shareable");
    console.log("Bob revoca el permiso. Ana pierde acceso a consultas nuevas y a la respuesta guardada.");
  } finally {
    await call(target, "group_permission", { group, can_share: true });
  }

  const { id, status } = await call(organizer, "meeting_propose", { recipients: people.slice(1), slots, minutes, group });
  assert.equal(status, "collecting");
  for (const person of people.slice(1)) {
    const { meetings } = await call(person, "meeting_inbox");
    assert.ok(meetings.some(meeting => meeting.id === id), `La propuesta debe estar en la bandeja de ${person}.`);
    await call(person, "meeting_respond", { id });
  }
  const proposal = await call(organizer, "meeting_get", { id });
  assert.equal(proposal.status, "proposed");
  assert.equal(Date.parse(proposal.slot), Date.parse(slots[1]));
  for (const person of people.slice(0, -1)) {
    assert.equal((await call(person, "meeting_decide", { id, accept: true })).status, "proposed");
  }
  assert.equal((await call(people.at(-1), "meeting_decide", { id, accept: true })).status, "confirmed");
  const confirmed = await call(organizer, "meeting_get", { id });
  assert.equal(confirmed.status, "confirmed");
  console.log(`${people.length}/${people.length} aceptaron el sábado a las 18:00 de Chile. Encuentro confirmado: ${id}`);
} finally {
  await Promise.allSettled([...sessions.values()].map(client => client.close()));
}
