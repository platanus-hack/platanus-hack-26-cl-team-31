import { spawn } from "node:child_process";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { mintServiceToken } from "@team-31/auth/service";
import { createAgentClient, createOwnerClient, createOwnerRuntime, localReadTool } from "@team-31/broker/client";
import { SharingRules, WakeNotice } from "@team-31/protocol";
import { verifyWebhookSignature } from "@team-31/wake";
import { askContactOwner } from "./contact-runtime.mjs";

const brokerEntry = join(dirname(fileURLToPath(import.meta.resolve("@team-31/broker-service/package.json"))), "dist/index.js");
const jwk = key => key.export({ format: "jwk" });

async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return server.address().port;
}

// Runs apps/broker with an in-memory store and keys that live only for this demo.
async function startBroker() {
  const probe = createServer();
  const port = await listen(probe);
  probe.close();
  await once(probe, "close");

  const mcp = generateKeyPairSync("ed25519");
  const web = generateKeyPairSync("ed25519");
  const child = spawn(process.execPath, [brokerEntry], {
    // Ana's tools speak MCP on stdout, so the broker logs go to stderr.
    stdio: ["ignore", "pipe", "inherit"],
    env: {
      PATH: process.env.PATH,
      BROKER_PORT: String(port),
      DATABASE_URL: "",
      BROKER_SIGNING_KEY: JSON.stringify(jwk(generateKeyPairSync("ed25519").privateKey)),
      NONCE_KEY: randomBytes(32).toString("base64"),
      SERVICE_JWT_PUBLIC_KEYS: JSON.stringify({ mcp: jwk(mcp.publicKey), web: jwk(web.publicKey) }),
      REQUEST_TTL_SECONDS: "120",
      WAKE_ALLOW_INSECURE: "1",
    },
  });
  child.stdout.pipe(process.stderr);
  const stop = () => child.kill();
  process.once("exit", stop);

  const baseUrl = `http://127.0.0.1:${port}`;
  for (let attempt = 0; ; attempt++) {
    if (child.exitCode !== null) throw new Error("El broker terminó al iniciar. Compílalo con pnpm build --filter @team-31/broker-service.");
    try {
      if ((await fetch(`${baseUrl}/healthz`)).ok) break;
    } catch {
      // Not listening yet.
    }
    if (attempt === 50) {
      stop();
      throw new Error("El broker no respondió en /healthz.");
    }
    await sleep(100);
  }

  return {
    agent: createAgentClient({
      baseUrl,
      getServiceToken: ({ userId, agentId, scopes }) =>
        mintServiceToken({ iss: "mcp", sub: userId, azp: agentId, scopes, privateKey: jwk(mcp.privateKey) }),
    }),
    owner: createOwnerClient({
      baseUrl,
      getServiceToken: ({ userId }) => mintServiceToken({ iss: "web", sub: userId, privateKey: jwk(web.privateKey) }),
    }),
    stop,
  };
}

export async function startDemoBroker(contacts) {
  const ana = { userId: "ana", agentId: "ana-bot", scopes: ["nexo:ask", "nexo:status"] };
  const { agent, owner, stop } = await startBroker();
  const routes = new Map();
  async function receive(req, res) {
    const target = routes.get(req.url);
    if (req.method !== "POST" || !target) return res.writeHead(404).end();
    const { name, secret, onWake } = target;
    let body = "";
    for await (const chunk of req) {
      body += chunk.toString();
      if (Buffer.byteLength(body) > 2048) return res.writeHead(413).end();
    }
    const timestamp = Number(req.headers["webhook-timestamp"]);
    const id = req.headers["webhook-id"];
    const signature = req.headers["webhook-signature"];
    if (typeof id !== "string" || typeof signature !== "string" || !Number.isSafeInteger(timestamp) ||
        Math.abs(Date.now() / 1000 - timestamp) > 60 || !verifyWebhookSignature(secret, id, timestamp, body, signature)) {
      return res.writeHead(401).end();
    }
    const notice = WakeNotice.parse(JSON.parse(body));
    if (id !== "evt_" + notice.requestId) return res.writeHead(400).end();
    res.writeHead(202).end();
    console.error(`${name} recibió el webhook firmado:`, notice.requestId);
    // The owner runtime ignores a retried wake while the same request is in progress.
    onWake(notice).catch(() => {
      console.error(`${name} no completó la consulta. La solicitud sigue pendiente hasta su vencimiento.`);
    });
  }
  const receiver = createServer((req, res) => receive(req, res).catch(() => res.writeHead(400).end()));
  function close() {
    receiver.close();
    stop();
  }

  try {
    const receiverPort = await listen(receiver);
    const anaAddress = await owner.claimAddress({ userId: ana.userId }, "ana");
    const addressBook = [];
    for (const { id, name, source, allowsInterest } of contacts) {
      const principal = { userId: id, agentId: id + "-bot", scopes: ["nexo:inbox", "nexo:reply"] };
      const path = `/agents/${principal.agentId}/wake`;
      const secret = "whsec_" + randomBytes(32).toString("base64");
      const onWake = createOwnerRuntime(agent, principal, [
        localReadTool("interest_check", ({ interest }) => askContactOwner(name, interest, source)),
      ]);
      routes.set(path, { name, secret, onWake });
      const address = await owner.claimAddress({ userId: id }, id);
      await owner.setRules({ userId: id }, SharingRules.parse({
        circles: {}, grants: {},
        people: allowsInterest ? { [anaAddress]: [{ tool: "interest_check", fields: ["matches"] }] } : {},
        defaultForUnknown: "deny",
      }));
      await agent.connectWake(principal, {
        kind: "standard_webhook", url: `http://127.0.0.1:${receiverPort}${path}`, secret,
      });
      addressBook.push({ name, address });
    }

    return {
      listContacts() { return addressBook; },
      async ask(to, tool, args) {
        if (!addressBook.some(contact => contact.address === to)) throw new Error("Contacto fuera de la agenda de Ana.");
        const request = await agent.ask(ana, { to, tool, args });
        console.error("Ana → broker:", request.decision, request.requestId);
        return request;
      },
      // The broker worker delivers the wake. Wait for the contact's answer until the request expires.
      async result(requestId) {
        const deadline = Date.now() + 120_000;
        for (;;) {
          const view = await agent.status(ana, requestId);
          if (view.final || Date.now() >= deadline) return view;
          await sleep(1_000);
        }
      },
      close,
    };
  } catch (error) {
    close();
    throw error;
  }
}
