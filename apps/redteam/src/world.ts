// Mundo ficticio del harness red team / blue team: un broker real en memoria, tres titulares
// (atacante, víctima con agente comprometido y espectador), llaves propias y telemetría en memoria.
import { generateKeyPairSync, verify } from "node:crypto";
import {
  InboxItem,
  RequesterView,
  type Address,
  type AskInput,
  type Category,
  type Grant,
  type GrantInput,
  type Owner,
  type Principal,
  type ReplyInput,
  type ReplyReceipt,
  type WakeTarget,
  type Waker,
} from "@team-31/protocol";
import { BrokerError, createBroker, createMemoryStore, type BrokerCore, type BrokerDeps } from "@team-31/broker";
import { createTelemetry, memorySink, type MemorySink } from "@team-31/telemetry";

// Datos ficticios que la víctima jamás autorizó compartir. Sirven de semilla (canary) y de
// evidencia: si aparecen en la vista del solicitante, hubo fuga.
export const CANARY = "canario-rojo-7733";
export const PRIVATE_HINT = "Diagnóstico privado ficticio";
export const PRIVATE_EMAIL = "pia.personal@correo-privado.example";
export const PRIVATE_PHONE = "+56987654321";
export const PRIVATE_URL = "https://bitacora-privada.example/pia";
export const PRIVATE_HANDLE = "@pia_privada";

const principals: Record<"attacker" | "victim" | "bystander", Principal> = {
  attacker: { userId: "mallory", agentId: "mallory-bot", scopes: ["sideband:ask", "sideband:inbox", "sideband:reply", "sideband:status"] },
  victim: { userId: "pia", agentId: "pia-bot", scopes: ["sideband:ask", "sideband:inbox", "sideband:reply", "sideband:status"] },
  bystander: { userId: "cesar", agentId: "cesar-bot", scopes: ["sideband:ask", "sideband:inbox", "sideband:reply", "sideband:status"] },
};

export type WakeCall = { target: WakeTarget; notice: unknown };

export type Harness = {
  broker: BrokerCore;
  sink: MemorySink;
  attacker: Principal;
  victim: Principal;
  bystander: Principal;
  attackerOwner: Owner;
  victimOwner: Owner;
  attackerAddress: Address;
  victimAddress: Address;
  bystanderAddress: Address;
  /** Avanza el reloj del broker (para probar expiración y TTL). */
  advance(ms: number): void;
  /** Ejecuta el barrido del worker con el reloj del harness (no el real). */
  tickNow(): Promise<{ expired: number; wakesOk: number; wakesRetried: number; wakesFailed: number }>;
  /** Avisos que el waker (ficticio) recibió, en orden. */
  wakes(): WakeCall[];
  /** Da a la víctima un grant hacia el atacante por cada categoría. */
  grantToAttacker(...categories: Category[]): Promise<Grant[]>;
  revokeGrants(): Promise<void>;
  ask(input: AskInput): Promise<RequesterView>;
  askQuestion(text: string, category: Category): Promise<RequesterView>;
  askInterest(interest: string): Promise<RequesterView>;
  /** Bandeja del agente de la víctima. */
  victimInbox(): Promise<InboxItem[]>;
  /** El agente de la víctima (comprometido) responde con lo que le pasen, usando su nonce. */
  victimReply(item: InboxItem, body: { outcome: "answered"; result: unknown } | { outcome: Exclude<ReplyInput["outcome"], "answered">; internalReason?: string }): Promise<ReplyReceipt>;
  status(requestId: string): Promise<RequesterView>;
  /** Verifica la firma del sobre final; con `tamper` verifica un pedido falsificado. */
  verifyFinal(view: RequesterView, tamper?: "requestId"): Promise<boolean>;
  close(): Promise<void>;
};

/** Código del error del broker (unauthorized|forbidden|invalid_input|conflict|expired|...). */
export function errorCode(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    return String((error as { code?: unknown }).code ?? "unknown");
  }
  return "unknown";
}

// Copia local del JSON canónico que usa el broker para firmar (packages/broker/src/core/crypto.ts),
// para verificar los sobres finales sin acoplarnos a módulos internos.
function serialize(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    return `[${Array.from(value, (entry) => serialize(entry) ?? "null").join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.keys(value).sort().flatMap((key) => {
      const nested = serialize((value as Record<string, unknown>)[key]);
      return nested === undefined ? [] : [`${JSON.stringify(key)}:${nested}`];
    });
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

export function canonicalJson(value: unknown): string {
  const json = serialize(value);
  if (json === undefined) throw new TypeError("El valor no se puede firmar como JSON.");
  return json;
}

export async function createHarness(): Promise<Harness> {
  const now = new Date("2026-11-21T15:00:00Z");
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const nonceKey = new Uint8Array(32).fill(7);
  const sink = memorySink();
  const telemetry = createTelemetry({ service: "broker", sink, lifecycle: false });
  const wakeCalls: WakeCall[] = [];
  const waker: Waker = {
    async wake(target, notice, attempt) {
      void attempt;
      wakeCalls.push({ target, notice });
      return { ok: true, retryable: false, ms: 1 };
    },
    async verifyCallback() {
      return { ok: true };
    },
  };

  const deps: BrokerDeps = {
    store: createMemoryStore(),
    waker,
    clock: { now: () => new Date(now.getTime()) },
    signingKey: privateKey,
    nonceKey,
    config: { requestTtlSeconds: 900, wakeRetryDelaysMs: [0, 10_000, 30_000], addressDomain: "sideband.app" },
    sanitize: {
      // Configuración de la víctima: canario propio. Los detectores de contactos y los marcadores
      // de inyección vienen por defecto (una política undefined prohíbe todo contacto).
      canaries: [CANARY],
      contacts: {},
    },
    telemetry,
  };
  const broker = createBroker(deps);

  const attackerOwner: Owner = { userId: principals.attacker.userId };
  const victimOwner: Owner = { userId: principals.victim.userId };
  const bystanderOwner: Owner = { userId: principals.bystander.userId };
  const attackerAddress: Address = await broker.owner.claimAddress(attackerOwner, "mallory-red");
  const victimAddress: Address = await broker.owner.claimAddress(victimOwner, "pia-victima");
  const bystanderAddress: Address = await broker.owner.claimAddress(bystanderOwner, "cesar-espectador");
  await broker.agent.inbox(principals.victim); // registra la conexión del agente de la víctima
  await broker.agent.inbox(principals.attacker); // registra la conexión del agente atacante
  await broker.agent.inbox(principals.bystander); // registra la conexión del espectador
  await broker.agent.connectWake(principals.victim, {
    kind: "standard_webhook", url: "https://example.com/redteam-wake", secret: "whsec_redteam",
  });

  return {
    broker,
    sink,
    attacker: principals.attacker,
    victim: principals.victim,
    bystander: principals.bystander,
    attackerOwner,
    victimOwner,
    attackerAddress,
    victimAddress,
    bystanderAddress,
    advance(ms) {
      now.setMilliseconds(now.getMilliseconds() + ms);
    },
    tickNow: () => broker.tick(new Date(now)),
    wakes: () => wakeCalls,
    async grantToAttacker(...categories) {
      const grants: Grant[] = [];
      for (const category of categories) {
        const input: GrantInput = { grantee: attackerAddress, category };
        grants.push(await broker.owner.setGrant(victimOwner, input));
      }
      return grants;
    },
    async revokeGrants() {
      for (const grant of await broker.owner.grants(victimOwner)) {
        await broker.owner.revokeGrant(victimOwner, grant.id);
      }
    },
    ask: (input) => broker.agent.ask(principals.attacker, input),
    askQuestion(text, category) {
      const input: AskInput = { to: victimAddress, tool: "question", args: { text, category } };
      return broker.agent.ask(principals.attacker, input);
    },
    askInterest(interest) {
      const input: AskInput = { to: victimAddress, tool: "interest_check", args: { interest } };
      return broker.agent.ask(principals.attacker, input);
    },
    victimInbox: async () => (await broker.agent.inbox(principals.victim)).map((row) => InboxItem.parse(row)),
    async victimReply(item, body) {
      const shared = { requestId: item.requestId, nonce: item.nonce };
      const input = (body.outcome === "answered"
        ? { ...shared, outcome: "answered", result: body.result }
        : { ...shared, outcome: body.outcome, internalReason: body.internalReason }) as ReplyInput;
      return broker.agent.reply(principals.victim, input);
    },
    status: async (requestId) => RequesterView.parse(await broker.agent.status(principals.attacker, requestId)),
    async verifyFinal(view, tamper) {
      if (!view.final) return false;
      const payload = view.decision === "allow"
        ? { requestId: view.requestId, outcome: "answered", result: view.result }
        : view.decision === "deny"
          ? { requestId: view.requestId, outcome: "deny", result: undefined }
          : { requestId: view.requestId, outcome: view.outcome, result: undefined };
      if (tamper === "requestId") payload.requestId = `${payload.requestId}x`;
      const bytes = Buffer.from(canonicalJson(payload));
      const signed = Buffer.from(view.signature, "base64url");
      return verify(null, bytes, publicKey, signed);
    },
    async close() {
      await telemetry.shutdown();
    },
  };
}

export function isBrokerError(error: unknown): error is BrokerError {
  return error instanceof BrokerError;
}
