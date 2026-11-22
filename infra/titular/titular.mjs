#!/usr/bin/env node
// titular.mjs — alta de un titular de Sideband para la imagen del contenedor.
//
//   node infra/titular/titular.mjs token    <Nombre>              → JSON con el access token
//   node infra/titular/titular.mjs conectar <NombreA> <NombreB> [categorías]
//
// Corre en el HOST, contra el stack del worktree. No reinventa el alta: usa el mismo cliente
// mínimo que el arnés (infra/sim/lib.mjs) y la misma secuencia de infra/sim/run.mjs —
// dev-login → dev-token → /v1/owner/address → invitación → aceptación → PUT del reparto.
//
// `token` imprime el access token en stdout. up.sh lo redirige a un archivo fuera del repo con
// permisos 600 y se lo pasa al contenedor por `--env-file`: nunca por argv ni por el entorno de
// un `docker run -e`.
import { loadEnv, createStack, sleep } from "../sim/lib.mjs";

const ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const TODAS = ["availability", "interests", "health", "general"];
const stack = createStack(loadEnv(ROOT));

const slug = (nombre) => nombre.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// Revocar una conexión de agente es irreversible: el broker nunca resucita la fila y cada
// `tools/call` del titular muere después en agent.connect. Este script jamás revoca; si encuentra
// una identidad quemada, exige un nombre nuevo.
async function altaTitular(nombre) {
  await stack.web("/api/dev-login", { name: nombre });
  const token = await stack.web("/api/dev-token", { name: nombre });

  const agents = await stack.owner(token.userId, "GET", "/v1/owner/agents");
  const mia = agents.items.find((agent) => agent.agentId === token.clientId);
  if (mia?.revokedAt) {
    throw new Error(
      `${nombre} tiene su conexión de agente revocada (${mia.revokedAt}) y el broker no la ` +
      "resucita. Usa un nombre de titular nuevo.",
    );
  }
  const ajenaViva = agents.items.find((agent) => agent.agentId !== token.clientId && !agent.revokedAt);
  if (ajenaViva) {
    throw new Error(
      `${nombre} ya tiene otra conexión de agente viva (${ajenaViva.agentId}). Sólo se admite una ` +
      "por titular, y revocarla es irreversible: usa un nombre de titular nuevo.",
    );
  }

  let me = await stack.owner(token.userId, "GET", "/v1/owner/me");
  if (!me.address) {
    me = { ...me, ...await stack.owner(token.userId, "POST", "/v1/owner/address", { localPart: `titular-${slug(nombre)}` }) };
  }
  return { name: nombre, userId: token.userId, accessToken: token.accessToken, address: me.address };
}

async function conectar(a, b, categorias) {
  const vista = await stack.owner(a.userId, "GET", "/v1/owner/connections");
  const yaEs = vista.contacts.some((contacto) => contacto.address === b.address);
  if (!yaEs) {
    if (!vista.outgoing.some((item) => item.address === b.address)) {
      await stack.owner(a.userId, "POST", "/v1/owner/connections", { to: b.address, share: categorias });
    }
    for (let intento = 0; intento < 20; intento += 1) {
      const suya = await stack.owner(b.userId, "GET", "/v1/owner/connections");
      const invitacion = suya.incoming.find((item) => item.address === a.address);
      if (invitacion) {
        await stack.owner(b.userId, "POST", `/v1/owner/invitations/${invitacion.requestId}`, { accept: true, share: categorias });
        break;
      }
      if (suya.contacts.some((contacto) => contacto.address === a.address)) break;
      await sleep(250);
    }
  }
  // Repetir la preparación no debe heredar el reparto de la corrida anterior.
  await stack.owner(a.userId, "PUT", `/v1/owner/connections/${b.address}/sharing`, categorias);
  await stack.owner(b.userId, "PUT", `/v1/owner/connections/${a.address}/sharing`, categorias);

  // El reparto declarado tiene que ser el que el broker guardó.
  for (const [uno, otro] of [[a, b], [b, a]]) {
    const suya = await stack.owner(uno.userId, "GET", "/v1/owner/connections");
    const contacto = suya.contacts.find((item) => item.address === otro.address);
    if (!contacto) throw new Error(`${uno.name} no quedó conectado con ${otro.name}.`);
    if ([...contacto.gives].sort().join(",") !== [...categorias].sort().join(",")) {
      throw new Error(`Reparto inesperado de ${uno.name} a ${otro.name}: ${JSON.stringify(contacto.gives)}`);
    }
  }
}

const [comando, ...resto] = process.argv.slice(2);

if (comando === "token" && resto.length === 1) {
  console.log(JSON.stringify(await altaTitular(resto[0])));
} else if (comando === "conectar" && resto.length >= 2) {
  const categorias = resto[2] ? resto[2].split(",").map((c) => c.trim()).filter(Boolean) : TODAS;
  const desconocidas = categorias.filter((c) => !TODAS.includes(c));
  if (desconocidas.length > 0) throw new Error(`Categorías desconocidas: ${desconocidas.join(", ")}`);
  const a = await altaTitular(resto[0]);
  const b = await altaTitular(resto[1]);
  await conectar(a, b, categorias);
  console.log(JSON.stringify({
    a: { name: a.name, address: a.address },
    b: { name: b.name, address: b.address },
    share: categorias,
  }));
} else {
  console.error("Uso: titular.mjs token <Nombre> | titular.mjs conectar <A> <B> [cat,cat]");
  process.exit(2);
}
