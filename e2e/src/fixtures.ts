import { randomUUID } from "node:crypto";
import { mintServiceToken } from "@team-31/auth/service";
import { createOwnerClient, type OwnerPort } from "@team-31/broker/client";
import type { Address, GrantInput, Owner } from "@team-31/protocol";
import { decodeJwt, type JWK } from "jose";
import { expect, onTestFinished } from "vitest";
import { z } from "zod";
import { connectAgent } from "./agents.js";

type Group = "contract" | "blocks" | "closure" | "isolation";
type Identity = { userId: string; agentId: string; token: string };

export const enabled = Boolean(process.env.E2E_MCP_URL);

function loopbackUrl(name: "E2E_MCP_URL" | "BROKER_URL"): URL {
  const value = process.env[name];
  const url = value && URL.parse(value);
  if (!url || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
      !["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error(`${name} debe ser una URL HTTP local sin credenciales ni parámetros.`);
  }
  return url;
}

function json<T>(name: string, schema: z.ZodType<T>): T {
  try {
    return schema.parse(JSON.parse(process.env[name] ?? ""));
  } catch {
    throw new Error(`Revisa el JSON de ${name}.`);
  }
}

const credentialsSchema = z.partialRecord(z.enum(["contract", "blocks", "closure", "isolation"]), z.array(z.string().min(1)));
// OAuth subjects are used for OwnerPort only after the matching SDK client authenticates.
function oauthIdentity(token: string): Identity {
  try {
    const { sub, azp } = decodeJwt(token);
    if (typeof sub === "string" && sub.length && typeof azp === "string" && azp.length) {
      return { userId: sub, agentId: azp, token };
    }
  } catch {
    // Keep OAuth tokens out of diagnostics.
  }
  throw new Error("E2E_OAUTH_TOKENS requiere access tokens JWT con sub y azp.");
}

function identities(group: Group, count: number): Identity[] {
  const mode = process.env.E2E_AUTH_MODE || "dev";
  if (mode === "dev") {
    return Array.from({ length: count }, () => {
      const userId = `e2e-${randomUUID()}`;
      const agentId = "sideband-e2e";
      return { userId, agentId, token: `dev:${userId}:${agentId}` };
    });
  }
  if (mode !== "oauth") throw new Error("E2E_AUTH_MODE debe ser dev u oauth.");

  const pools = json("E2E_OAUTH_TOKENS", credentialsSchema);
  const groupTokens = pools[group];
  if (!groupTokens || groupTokens.length < count) {
    throw new Error(`E2E_OAUTH_TOKENS necesita ${count} tokens para ${group}.`);
  }
  const subjects = Object.values(pools).flatMap((tokens) => tokens.map(oauthIdentity)).map(({ userId }) => userId);
  if (new Set(subjects).size !== subjects.length) {
    throw new Error("Cada token en E2E_OAUTH_TOKENS debe pertenecer a un usuario de prueba distinto.");
  }
  return groupTokens.slice(0, count).map(oauthIdentity);
}

export async function seedAgents(group: Group, count: number) {
  const mcp = loopbackUrl("E2E_MCP_URL");
  const privateKey: JWK = json("WEB_SERVICE_PRIVATE_KEY", z.object({
    kty: z.literal("OKP"), crv: z.literal("Ed25519"), x: z.string(), d: z.string(),
  }));
  const ownerPort: OwnerPort = createOwnerClient({
    baseUrl: loopbackUrl("BROKER_URL").href,
    getServiceToken: ({ userId }) => mintServiceToken({ iss: "web", sub: userId, privateKey }),
  });

  const connections: Awaited<ReturnType<typeof connectAgent>>[] = [];
  onTestFinished(async () => { await Promise.all(connections.map((agent) => agent.close())); });

  const seeded = await Promise.allSettled(identities(group, count).map(async ({ userId, agentId, token }) => {
    const agent = await connectAgent(mcp, token);
    connections.push(agent);
    const owner: Owner = { userId };
    const info = await ownerPort.me(owner);
    if (info.address && !info.address.startsWith("e2e-")) {
      throw new Error("Usa una cuenta de prueba con dirección e2e-* o sin dirección.");
    }
    const address = info.address ?? await ownerPort.claimAddress(owner, `e2e-${randomUUID().slice(0, 23)}`);
    await agent.inbox(); // The first authenticated tool call creates the agent connection.
    await ownerPort.setWake(owner, agentId, { kind: "none" });
    // Earlier runs may have left grants on this test account.
    for (const grant of await ownerPort.grants(owner)) await ownerPort.revokeGrant(owner, grant.id);
    return { agent, agentId, owner, address };
  }));
  return {
    ownerPort,
    agents: seeded.map((result) => {
      if (result.status === "rejected") throw result.reason;
      return result.value;
    }),
  };
}

export async function grantTo(
  ownerPort: OwnerPort, owner: Owner, senders: Address[], tool: GrantInput["tool"], fields: string[],
) {
  for (const grantee of senders) await ownerPort.setGrant(owner, { grantee, tool, fields });
}

export async function inboxItem(agent: Awaited<ReturnType<typeof connectAgent>>, requestId: string) {
  const item = (await agent.inbox()).find((entry) => entry.requestId === requestId);
  expect(item, "La solicitud debe aparecer en la bandeja del destinatario.").toBeDefined();
  return item!;
}
