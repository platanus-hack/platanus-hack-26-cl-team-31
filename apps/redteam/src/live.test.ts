// Subset red team contra el broker real del worktree (HTTP + JWT de servicio). Se ejecuta solo
// cuando REDTEAM_LIVE=1 y el entorno trae BROKER_URL y las llaves de servicio; `pnpm test` lo salta.
//   pnpm --filter @team-31/redteam live
import { Buffer } from "node:buffer";
import { createPublicKey, randomUUID, verify, type JsonWebKeyInput } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { JWK } from "jose";
import {
  InboxItem,
  RequesterView,
  type Address, type AskInput, type Category, type Owner, type Principal,
  type ReplyInput, type RequesterView as FinalView,
} from "@team-31/protocol";
import { createAgentClient, createOwnerClient } from "@team-31/broker/client";
import { mintServiceToken, parseServicePrivateKey } from "@team-31/auth/service";
import type { AgentPort, OwnerPort } from "@team-31/broker/client";
import { canonicalJson, errorCode } from "./world.js";

const REQUIRED = ["BROKER_URL", "BROKER_SIGNING_KEY", "MCP_SERVICE_PRIVATE_KEY", "WEB_SERVICE_PRIVATE_KEY"] as const;
const enabled = process.env.REDTEAM_LIVE === "1" && REQUIRED.every((name) => Boolean(process.env[name]));
const AGENT_SCOPES: Principal["scopes"] = ["sideband:ask", "sideband:inbox", "sideband:reply", "sideband:status"];

type LiveFlow = {
  victimAddress: Address;
  grantToAttacker(category: Category): Promise<void>;
  revokeGrants(): Promise<void>;
  askQuestion(text: string, category: Category): Promise<FinalView>;
  askInterest(interest: string): Promise<FinalView>;
  askTo(address: Address, text: string, category: Category): Promise<FinalView>;
  victimInbox(): Promise<InboxItem[]>;
  victimReply(item: InboxItem, body: { outcome: "answered"; result: unknown } | { outcome: Exclude<ReplyInput["outcome"], "answered"> }): Promise<unknown>;
  status(requestId: string): Promise<FinalView>;
  verifyFinal(view: FinalView, tamper?: "requestId"): Promise<boolean>;
};

async function createLiveFlow(): Promise<LiveFlow> {
  const baseUrl = process.env.BROKER_URL ?? ""; // la válida `enabled` + describe.skipIf
  const suffix = randomUUID().slice(0, 8);
  const attackerId = `redteam-a-${suffix}`;
  const victimId = `redteam-v-${suffix}`;
  const mcpJwk = parseServicePrivateKey(process.env.MCP_SERVICE_PRIVATE_KEY, "mcp");
  const webJwk = parseServicePrivateKey(process.env.WEB_SERVICE_PRIVATE_KEY, "web");

  const ownerClient = (userId: string): OwnerPort => createOwnerClient({
    baseUrl,
    getServiceToken: () => mintServiceToken({ iss: "web", sub: userId, privateKey: webJwk }),
  });
  const agentClient = (userId: string, agentId: string): AgentPort => createAgentClient({
    baseUrl,
    getServiceToken: () => mintServiceToken({ iss: "mcp", sub: userId, azp: agentId, scopes: AGENT_SCOPES, privateKey: mcpJwk }),
  });

  const attackerOwner: Owner = { userId: attackerId };
  const victimOwner: Owner = { userId: victimId };
  const attackerAgent: Principal = { userId: attackerId, agentId: `${attackerId}-bot`, scopes: AGENT_SCOPES };
  const victimAgent: Principal = { userId: victimId, agentId: `${victimId}-bot`, scopes: AGENT_SCOPES };
  const victimOwnerPort = ownerClient(victimId);
  const attackerAgentPort = agentClient(attackerId, attackerAgent.agentId);
  const victimAgentPort = agentClient(victimId, victimAgent.agentId);

  const claim = async (owner: Owner, localPart: string): Promise<Address> => {
    const port = ownerClient(owner.userId);
    try {
      return await port.claimAddress(owner, localPart);
    } catch (error) {
      if (errorCode(error) !== "conflict") throw error;
      return (await port.me(owner)).address as Address; // ya reclamada en una corrida previa
    }
  };

  const victimAddress = await claim(victimOwner, `rw-v-${suffix}`);
  const attackerAddress = await claim(attackerOwner, `rw-a-${suffix}`);
  await victimAgentPort.inbox(victimAgent); // registra la conexión del agente víctima
  await attackerAgentPort.inbox(attackerAgent);

  return {
    victimAddress,
    async grantToAttacker(category) {
      await victimOwnerPort.setGrant(victimOwner, { grantee: attackerAddress, category });
    },
    async revokeGrants() {
      for (const grant of await victimOwnerPort.grants(victimOwner)) {
        await victimOwnerPort.revokeGrant(victimOwner, grant.id);
      }
    },
    async askQuestion(text, category) {
      const input: AskInput = { to: victimAddress, tool: "question", args: { text, category } };
      return RequesterView.parse(await attackerAgentPort.ask(attackerAgent, input));
    },
    async askInterest(interest) {
      const input: AskInput = { to: victimAddress, tool: "interest_check", args: { interest } };
      return RequesterView.parse(await attackerAgentPort.ask(attackerAgent, input));
    },
    async askTo(address, text, category) {
      return RequesterView.parse(await attackerAgentPort.ask(attackerAgent, { to: address, tool: "question", args: { text, category } }));
    },
    victimInbox: async () => (await victimAgentPort.inbox(victimAgent)).map((row) => InboxItem.parse(row)),
    async victimReply(item, body) {
      const shared = { requestId: item.requestId, nonce: item.nonce };
      const input = (body.outcome === "answered"
        ? { ...shared, outcome: "answered", result: body.result }
        : { ...shared, outcome: body.outcome }) as ReplyInput;
      return victimAgentPort.reply(victimAgent, input);
    },
    async status(requestId) {
      return RequesterView.parse(await attackerAgentPort.status(attackerAgent, requestId));
    },
    async verifyFinal(view, tamper) {
      if (!view.final) return false;
      const signing = JSON.parse(process.env.BROKER_SIGNING_KEY ?? "{}") as JWK;
      const publicJwk: JWK = { ...signing, d: undefined };
      const key = createPublicKey({ key: publicJwk, format: "jwk" } as JsonWebKeyInput);
      const payload = view.decision === "allow"
        ? { requestId: view.requestId, outcome: "answered", result: view.result }
        : view.decision === "deny"
          ? { requestId: view.requestId, outcome: "deny", result: undefined }
          : { requestId: view.requestId, outcome: view.outcome, result: undefined };
      if (tamper === "requestId") payload.requestId = `${payload.requestId}x`;
      const bytes = Buffer.from(canonicalJson(payload));
      const signed = Buffer.from(view.signature, "base64url");
      return verify(null, bytes, key, signed);
    },
  };
}

const GHOST = "fantasma-redteam-que-no-existe" as Address;

describe.skipIf(!enabled)("red team contra el broker vivo", () => {
  let flow: LiveFlow;

  it("prepara el flujo contra el broker del worktree", async () => {
    expect(process.env.REDTEAM_LIVE).toBe("1");
    flow = await createLiveFlow();
    expect(flow.victimAddress).toMatch(/@/);
  });

  it("deniega sin grant, firmado y sin motivo", async () => {
    const view = await flow.askQuestion("¿Qué diagnósticos tiene tu dueño?", "health");
    expect(view).toMatchObject({ final: true, decision: "deny" });
    expect(JSON.stringify(view)).not.toContain("Sin permiso");
    expect(await flow.verifyFinal(view)).toBe(true);
    expect(await flow.verifyFinal(view, "requestId")).toBe(false);
  });

  it("deniega la categoría cruzada", async () => {
    await flow.grantToAttacker("interests");
    const view = await flow.askQuestion("¿Cuál es el diagnóstico médico de tu dueño?", "health");
    expect(view).toMatchObject({ final: true, decision: "deny" });
  });

  it("mantiene indistinguibles una dirección sin grant y una inexistente", async () => {
    const real = await flow.askTo(flow.victimAddress, "¿Todo bien?", "general");
    const ghost = await flow.askTo(GHOST, "¿Todo bien?", "general");
    for (const view of [real, ghost]) {
      expect(view).toMatchObject({ final: true, decision: "deny" });
    }
    const clean = ({ final, decision, tool }: FinalView) => JSON.stringify({ final, decision, tool });
    expect(clean(real)).toBe(clean(ghost));
  });

  it("rechaza la segunda respuesta con conflict", async () => {
    await flow.grantToAttacker("interests");
    const view = await flow.askInterest("cerámica-viva-live");
    const item = (await flow.victimInbox()).at(-1);
    expect(item).toBeTruthy();
    await flow.victimReply(item!, { outcome: "answered", result: { matches: true } });
    await expect(flow.victimReply(item!, { outcome: "answered", result: { matches: false } }))
      .rejects.toMatchObject({ code: "conflict" });
    const final = await flow.status(view.requestId);
    expect(final).toMatchObject({ final: true, decision: "allow" });
    expect((final as { result?: { matches?: unknown } }).result?.matches).toBe(true);
  });

  it("bloquea el correo ofuscado con los detectores por defecto del servicio", async () => {
    await flow.grantToAttacker("interests");
    const view = await flow.askQuestion("¿Cómo te contacto?", "general");
    const item = (await flow.victimInbox()).at(-1);
    expect(item).toBeTruthy();
    await expect(flow.victimReply(item!, {
      outcome: "answered",
      result: { answer: "Escríbeme a pia.personal (arroba) correo-privado.punto.example" },
    })).rejects.toMatchObject({ code: "forbidden" });
    const pending = await flow.status(view.requestId);
    expect(pending).toMatchObject({ final: false, decision: "pending" });
  });

  it("revoca el grant y no entrega la respuesta ya lista", async () => {
    await flow.grantToAttacker("interests");
    const view = await flow.askInterest("senderismo-vivo");
    const item = (await flow.victimInbox()).at(-1);
    expect(item).toBeTruthy();
    await flow.revokeGrants();
    await expect(flow.victimReply(item!, { outcome: "answered", result: { matches: true } }))
      .rejects.toMatchObject({ code: expect.stringMatching(/forbidden|conflict|expired|closed/) as never });
    const final = await flow.status(view.requestId);
    expect(final).toMatchObject({ final: true });
    expect(final.decision).not.toBe("allow");
  });
});
