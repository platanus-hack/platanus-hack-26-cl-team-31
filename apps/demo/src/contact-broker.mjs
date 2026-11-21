import { createHmac } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { mintServiceToken } from "@team-31/auth/service";
import { createAgentClient, createOwnerClient } from "@team-31/broker/client";
import { ADDRESS_DOMAIN, LocalPart } from "@team-31/protocol";
import { consoleSink, createTelemetry, tracedFetch } from "@team-31/telemetry";

// stdout belongs to the MCP stdio transport.
export const demoTelemetry = createTelemetry({
  service: "coordination", lifecycle: false, heartbeatMs: 0,
  sink: process.env.TELEMETRY_SINK === "console" || (!process.env.TELEMETRY_SINK && !process.env.DATABASE_URL)
    ? consoleSink({ stream: process.stderr }) : undefined,
});

export function localBrokerUrl() {
  const url = new URL(process.env.BROKER_URL);
  if (process.env.NODE_ENV === "production" || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
      url.protocol !== "http:" || url.port !== process.env.BROKER_PORT || url.href !== url.origin + "/") {
    throw new Error("Contactos de Ana requiere el BROKER_URL local del worktree.");
  }
  return url.origin;
}

export function contactAddress(id) {
  return LocalPart.parse("demo-" + LocalPart.parse(id)) + "@" + ADDRESS_DOMAIN;
}

export function contactPrincipal(id) {
  const userId = "demo-contact-" + LocalPart.parse(id);
  return { userId, agentId: userId + "-bot", scopes: ["sideband:inbox", "sideband:reply"] };
}

export function contactWakeUrl(id) {
  const port = Number(process.env.WEB_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("WEB_PORT inválido.");
  return `http://127.0.0.1:${port}/api/demo/contact-wake/${LocalPart.parse(id)}`;
}

export function contactWakeSecret(id) {
  const key = Buffer.from(process.env.WAKE_SECRETS_KEY ?? "", "base64");
  if (key.length !== 32) throw new Error("Revisa WAKE_SECRETS_KEY con pnpm bootstrap.");
  const mac = createHmac("sha256", key).update("sideband/demo/contact-wake/v1/" + LocalPart.parse(id));
  return "whsec_" + mac.digest("base64");
}

export function contactAgent() {
  const privateKey = JSON.parse(process.env.MCP_SERVICE_PRIVATE_KEY);
  return createAgentClient({
    baseUrl: localBrokerUrl(), fetch: tracedFetch(demoTelemetry),
    getServiceToken: ({ userId, agentId, scopes }) => mintServiceToken({ iss: "mcp", sub: userId, azp: agentId, scopes, privateKey }),
  });
}

export function contactOwner() {
  const privateKey = JSON.parse(process.env.WEB_SERVICE_PRIVATE_KEY);
  return createOwnerClient({
    baseUrl: localBrokerUrl(), fetch: tracedFetch(demoTelemetry),
    getServiceToken: ({ userId }) => mintServiceToken({ iss: "web", sub: userId, privateKey }),
  });
}

export function createContactQueries(contacts, { agent = contactAgent(), fixtureId } = {}) {
  const ana = { ...contactPrincipal("ana"), scopes: ["sideband:ask", "sideband:status"] };
  const directory = new Map(contacts.map(contact => [contactAddress(contact.id), contact]));
  const sessionRequests = new Set();
  return {
    listContacts() {
      return Array.from(directory, ([address, { name }]) => ({ name, address }));
    },
    async ask(to, tool, args) {
      const contact = directory.get(to);
      if (!contact) throw new Error("Contacto fuera de la agenda de Ana.");
      return demoTelemetry.span("coordination.tool.call", {
        userId: ana.userId, agentId: ana.agentId, attrs: { tool: "ask_contact" },
      }, async span => {
        const purpose = fixtureId && contact.override ? `demo-fixture:${fixtureId}` : undefined;
        const view = await agent.ask(ana, { to, tool, args, purpose });
        sessionRequests.add(view.requestId);
        demoTelemetry.identify({ requestId: view.requestId });
        span.set({ outcome: view.decision });
        return view;
      });
    },
    async result(requestId) {
      if (!sessionRequests.has(requestId)) {
        demoTelemetry.emit("coordination.tool.call", { userId: ana.userId, agentId: ana.agentId,
          attrs: { tool: "await_contact", outcome: "not_shareable" } });
        throw new Error("Solicitud fuera de esta sesión.");
      }
      return demoTelemetry.span("coordination.tool.call", {
        requestId, userId: ana.userId, agentId: ana.agentId, attrs: { tool: "await_contact" },
      }, async span => {
        const deadline = Date.now() + 120_000;
        for (;;) {
          const view = await agent.status(ana, requestId);
          if (view.final || Date.now() >= deadline) {
            span.set({ outcome: view.decision });
            return view;
          }
          await sleep(1_000);
        }
      });
    },
  };
}

// Claude needs the user's login and model proxy. Keep Sideband's signing keys in trusted processes.
export function claudeEnv() {
  return Object.fromEntries(Object.entries(process.env).filter(([name]) =>
    /^(ANTHROPIC_|CLAUDE_|CLAUDECODE|LC_)/.test(name) ||
    ["HOME", "PATH", "USER", "SHELL", "TMPDIR", "TMP", "TEMP", "LANG", "TERM", "XDG_CONFIG_HOME",
      "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "NODE_EXTRA_CA_CERTS", "SSL_CERT_FILE"].includes(name)));
}
