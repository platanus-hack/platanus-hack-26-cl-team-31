import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { randomBytes } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { setTimeout } from "node:timers/promises";

import { oauthAgent } from "./fixtures.mjs";

async function waitFor(label, read, timeout = 15_000) {
  const until = performance.now() + timeout;
  do {
    const result = await read();
    if (result) return result;
    await setTimeout(220);
  } while (performance.now() < until);
  throw new Error(`No se confirmó: ${label}.`);
}

async function tool(actor, name, args) {
  const result = await actor.client.callTool({ name, arguments: args }, undefined, { timeout: 10_000 });
  assert(!result.isError, `${actor.name}: ${name} devolvió ${result.structuredContent?.error?.code ?? "un error"}.`);
  return result.structuredContent;
}

function assertFinal(view, decision) {
  assert.equal(view.final, true, "La solicitud debe quedar cerrada.");
  assert.equal(view.decision, decision);
  assert(/^[\w-]{86}$/.test(view.signature), "La respuesta final debe incluir la firma Ed25519 del broker.");
}

async function listen(handler) {
  const server = createServer(handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  return {
    url: new URL(`http://127.0.0.1:${port}`),
    async close() {
      if (!server.listening) return;
      const closed = once(server, "close");
      server.close();
      server.closeAllConnections();
      await closed;
    },
  };
}

async function calendarReceiver() {
  const token = randomBytes(24).toString("base64url");
  const notices = new Set();
  const server = await listen(async (req, res) => {
    if (req.method !== "POST" || req.url !== "/hooks/agent" || req.headers.authorization !== `Bearer ${token}`) {
      res.writeHead(404).end();
      return;
    }
    const requestId = req.headers["idempotency-key"];
    try {
      let body = "";
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 2_048) {
          res.writeHead(413).end();
          return;
        }
      }
      const { message, deliver, agentId } = JSON.parse(body);
      assert(/^[0-9a-f-]{36}$/.test(requestId) && message.startsWith(`Tienes una solicitud nueva en Nexo (${requestId}). Usa nexo_inbox`));
      assert.equal(deliver, false);
      assert.equal(agentId, "main");
      notices.add(requestId);
      res.writeHead(202).end();
    } catch {
      res.writeHead(400).end();
    }
  });
  return { ...server, notices, target: { kind: "openclaw_hooks", baseUrl: server.url.origin, token, agentId: "main" } };
}

async function browserLogin({ web }, session) {
  const path = "/" + randomBytes(24).toString("base64url");
  let used = false;
  const bridge = await listen((req, res) => {
    if (req.method !== "GET" || req.url !== path || used) {
      res.writeHead(404).end();
      return;
    }
    used = true;
    res.writeHead(303, {
      "Cache-Control": "no-store", "Referrer-Policy": "no-referrer",
      "Set-Cookie": session.cookies.map(({ name, value }) => `${name}=${value}; Path=/; HttpOnly; SameSite=Lax`),
      Location: new URL("/cable", web).href,
    }).end();
  });
  return { url: new URL(path, bridge.url), close: bridge.close };
}

function nextMonday() {
  const date = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", year: "numeric", month: "numeric", day: "numeric" }).formatToParts(date);
  const value = (name) => Number(parts.find(({ type }) => type === name).value);
  const monday = new Date(Date.UTC(value("year"), value("month") - 1, value("day")));
  monday.setUTCDate(monday.getUTCDate() + ((8 - monday.getUTCDay()) % 7 || 7));
  return monday.toISOString().slice(0, 10);
}

export async function rehearse(fixtures, { run, actors }, present) {
  assert(actors?.simon && actors?.dot && actors?.grok && actors?.claude, "Completa el seed antes de ensayar.");
  const { test, owner } = fixtures;
  const destination = actors.simon;
  assert.equal((await owner.me(destination)).address, destination.address, "El broker debe usar la base descartable de la demo.");
  const sessions = Object.fromEntries(await Promise.all(Object.entries(actors).map(async ([role, { userId }]) =>
    [role, await test.login({ userId })],
  )));
  const clients = [];
  let terminal, receiver, bridge;
  const prompts = new AbortController();
  try {
    const setup = performance.now();
    for (const [name, session] of [
      ["OpenClaw", sessions.simon], ["OpenClaw secundario", sessions.simon], ["Dot", sessions.dot],
      ["Grok Bot", sessions.grok], ["Claude Code", sessions.claude],
    ]) {
      clients.push(await oauthAgent(fixtures, { run, name, session }));
    }
    const [openclaw, secondary, dot, grok, claude] = clients;
    await tool(openclaw, "nexo_inbox", {});
    await tool(secondary, "nexo_inbox", {});
    receiver = await calendarReceiver();
    await owner.setWake(destination, openclaw.agentId, receiver.target);

    if (present) {
      assert(process.stdin.isTTY, "Usa una terminal interactiva para presentar la demo.");
      terminal = createInterface({ input: process.stdin, output: process.stdout });
      terminal.once("close", () => prompts.abort());
      bridge = await browserLogin(fixtures, sessions.simon);
      console.log(`Abre una ventana privada con este enlace local de un uso: ${bridge.url}`);
      console.log("Abre Inicio, Reglas y Agentes en pestañas del mismo navegador. Conserva El cable en una pestaña.");
      await terminal.question("Cuando El cable esté en vivo, pulsa Enter. ", { signal: prompts.signal });
      await bridge.close();
    }
    console.log(`1. OAuth PKCE y conexión MCP de 5 clientes locales (${seconds(setup)} s de preparación).`);

    const started = performance.now();
    const step = async (label, action) => {
      const start = performance.now();
      console.log(label);
      await action();
      console.log(`   Confirmado en ${seconds(start)} s.`);
    };
    const interact = async (instruction) => {
      return await terminal?.question(`${instruction} Pulsa Enter para continuar. `, { signal: prompts.signal });
    };

    const args = { date: nextMonday(), start: "11:00", durationMinutes: 30, timezone: "America/Santiago" };
    const ask = (actor) => tool(actor, "nexo_ask", { to: destination.address, tool: "availability", args });
    const check = (actor, requestId) => tool(actor, "nexo_check", { requestId });

    async function replyFromCalendar(actor, requestId, expectedFields) {
      await waitFor("aviso HTTP al OpenClaw local", () => receiver.notices.has(requestId));
      await waitFor("aviso registrado en Actividad", async () => (await owner.activity(destination))
        .find((item) => item.requestId === requestId)?.events.some((event) => event.kind === "wake"));
      const { items } = await tool(openclaw, "nexo_inbox", {});
      const item = items.find((item) => item.requestId === requestId);
      assert(item && item.tool === "availability");
      assert.deepEqual(item.args, args);
      assert.equal(item.senderMessage.trusted, false);
      assert.deepEqual([...item.allowedFields].sort(), expectedFields);
      // Agenda ficticia del próximo lunes. El bloque de las 11:00 está ocupado.
      const calendar = { occupied: ["11:00"], freeSlots: ["12:00-12:30", "15:00-15:30"] };
      const availability = { available: !calendar.occupied.includes(item.args.start), freeSlots: calendar.freeSlots };
      const result = Object.fromEntries(item.allowedFields.map((field) => [field, availability[field]]));
      await tool(openclaw, "nexo_reply", { requestId, nonce: item.nonce, outcome: "answered", result });

      const final = await check(actor, requestId);
      assertFinal(final, "allow");
      assert.deepEqual(final.result, result);
      console.log(`   ${requestId}: ${JSON.stringify(final.result)}.`);
    }

    await step(`2. Dot local pregunta por el lunes ${args.date} a las 11:00.`, async () => {
      const pending = await ask(dot);
      assert.equal(pending.waitingFor, "agent");
      await replyFromCalendar(dot, pending.requestId, ["available", "freeSlots"]);
      await interact("Muestra la tarjeta de Dot con el aviso y la respuesta en El cable.");
    });

    await step("3. Claude Code local pregunta sin permiso previo.", async () => {
      const pending = await ask(claude);
      assert.equal(pending.waitingFor, "owner");
      assert((await owner.pending(destination)).some((item) => item.requestId === pending.requestId));
      const mode = await interact("En Inicio, actualiza y pulsa «Aprobar una vez» en la solicitud de Claude Code. Escribe api si la app falla.");
      if (!present || mode === "api") await owner.decide(destination, pending.requestId, { kind: "approve_once" });
      await replyFromCalendar(claude, pending.requestId, ["available"]);
      const again = await ask(claude);
      assert.equal(again.waitingFor, "owner", "La aprobación se aplica a una sola solicitud.");
      await owner.decide(destination, again.requestId, { kind: "deny" });
      console.log("   Una nueva pregunta de Claude volvió a esperar al dueño.");
    });

    await step(`4. Simon bloquea en vivo la dirección de Grok Bot local: ${actors.grok.address}`, async () => {
      const mode = await interact("En Reglas, añade esta dirección en «Personas bloqueadas» y pulsa «Guardar reglas». Escribe api si la app falla.");
      if (!present || mode === "api") {
        const rules = await owner.getRules(destination);
        await owner.setRules(destination, { ...rules, blocked: [...rules.blocked, actors.grok.address] });
      }
      const denied = await ask(grok);
      assertFinal(denied, "deny");
      assert.equal(denied.result, undefined);
      assert.equal(denied.outcome, undefined);
      console.log("   Grok recibió deny sin motivo ni datos.");
    });

    await step(`5. Simon desconecta el OpenClaw secundario (${secondary.agentId}).`, async () => {
      const mode = await interact("En Agentes, localiza ese identificador y pulsa «Desconectar» y «Confirmar desconexión». Escribe api si la app falla.");
      if (!present || mode === "api") await owner.revokeAgent(destination, secondary.agentId);
      const denied = await secondary.client.callTool({ name: "nexo_inbox", arguments: {} }, undefined, { timeout: 10_000 });
      assert.equal(denied.isError, true);
      assert.equal(denied.structuredContent?.error?.code, "not_found");
      console.log("   nexo_inbox con el mismo acceso OAuth devuelve not_found.");
    });

    await step("6. Apagamos el receptor OpenClaw local y Dot pregunta de nuevo.", async () => {
      await receiver.close();
      const pending = await ask(dot);
      assert.equal(pending.waitingFor, "agent");
      const final = await waitFor("cierre automático del worker", async () => {
        const view = await check(dot, pending.requestId);
        return view.final && view;
      }, 18_000);
      assertFinal(final, "unanswered");
      assert(["delivery_failed", "expired"].includes(final.outcome), "Cierre por fallo de entrega o plazo agotado.");
      console.log(`   ${pending.requestId}: ${final.outcome}, final: true, con firma.`);
      await interact("Muestra el cierre de la última solicitud en El cable.");
    });

    console.log(`Flujo del paso 2 al 6: ${seconds(started)} s. Preparación OAuth registrada en el paso 1.`);
  } finally {
    terminal?.close();
    await Promise.allSettled([bridge?.close(), receiver?.close(), ...clients.map(({ client }) => client.close())]);
  }
}

function seconds(start) {
  return ((performance.now() - start) / 1000).toFixed(2);
}
