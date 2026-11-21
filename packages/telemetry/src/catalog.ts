// Catálogo de eventos de Sideband (docs/admin.md#3). Cada evento se declara una vez con su
// tipo (kind), su nivel por defecto y los atributos permitidos.
//
// Reglas para agregar un evento:
// - Solo escalares (string, number, boolean). Nada de objetos ni arreglos.
// - Prefiere enums y códigos (`code()`) antes que strings libres.
// - Prohibido: tokens, encabezados Authorization, nonces, secretos de aviso, args, result,
//   texto libre (pregunta, propósito, motivo, nota, respuesta) y URLs completas de aviso.
// Los atributos no declarados se descartan en emit(): nunca llegan a ops.events.
import { z } from "zod";
import type { EventKind, Level } from "./types.js";

type AttrShape = Record<string, z.ZodType<string | number | boolean | undefined>>;

export interface EventDefinition<N extends string = string, S extends AttrShape = AttrShape> {
  name: N;
  kind: EventKind;
  level: Level;
  description: string;
  attrs: z.ZodObject<S>;
}

/** Declara un evento del catálogo. Todos los atributos son opcionales. */
export function defineEvent<const N extends string, S extends AttrShape>(definition: {
  name: N;
  kind: EventKind;
  level?: Level;
  description: string;
  attrs: S;
}): EventDefinition<N, { [K in keyof S]: z.ZodOptional<S[K]> }> {
  const optional = Object.fromEntries(
    Object.entries(definition.attrs).map(([key, schema]) => [key, schema.optional()]),
  ) as { [K in keyof S]: z.ZodOptional<S[K]> };
  return {
    name: definition.name,
    kind: definition.kind,
    level: definition.level ?? "info",
    description: definition.description,
    // z.object descarta las llaves no declaradas (strip), que es justo la redacción que queremos.
    attrs: z.object(optional),
  };
}

// ---------- Tipos de atributo ----------

/** Identificador o código sin espacios (rutas, nombres de herramienta, códigos de error). */
const code = () => z.string().min(1).max(128).regex(/^[\w.:/@*-]+$/);
/** Identificador opaco (ids de usuario, agente, cliente, request). */
const id = () => z.string().min(1).max(128);
/** Lista de códigos separada por comas (p. ej. `leak-guard:private_hint,policy:dropped`), nunca texto libre. */
const codes = () => z.string().min(1).max(1024).regex(/^[\w.:/@*-]+(,[\w.:/@*-]+)*$/);
const int = () => z.number().int();
const bool = () => z.boolean();

const lifecycleAttrs = { version: z.string().max(64), dropped: int().nonnegative() };
const adminAttrs = { action: code(), target: id(), tool: code() };

export const catalog = [
  defineEvent({ name: "service.started", kind: "lifecycle", description: "El servicio arrancó.", attrs: lifecycleAttrs }),
  defineEvent({
    name: "service.heartbeat",
    kind: "lifecycle",
    level: "debug",
    description: "Latido cada 30 s. dropped = eventos descartados por cola llena desde el arranque.",
    attrs: lifecycleAttrs,
  }),
  defineEvent({ name: "service.stopping", kind: "lifecycle", description: "El servicio se está deteniendo.", attrs: lifecycleAttrs }),

  defineEvent({
    name: "http.request",
    kind: "http",
    description: "Span de un request HTTP. route es el patrón (nunca la ruta cruda); bucket es la clase de status (2xx…5xx).",
    attrs: { method: code(), route: code(), status: int(), bucket: code() },
  }),
  defineEvent({ name: "http.rate_limited", kind: "http", level: "warn", description: "Request rechazado por límite de tasa.", attrs: { route: code(), bucket: code() } }),

  defineEvent({ name: "auth.token.verified", kind: "auth", description: "Access token verificado.", attrs: { issuer: code(), reason: code() } }),
  defineEvent({ name: "auth.token.rejected", kind: "auth", level: "warn", description: "Access token rechazado (reason es un código).", attrs: { issuer: code(), reason: code() } }),
  defineEvent({
    name: "auth.service_jwt.rejected",
    kind: "auth",
    level: "warn",
    description: "JWT de servicio rechazado.",
    attrs: { expectedIss: code(), reason: code() },
  }),
  defineEvent({ name: "auth.oauth.consent", kind: "auth", description: "Decisión de consentimiento OAuth.", attrs: { clientId: id(), granted: bool() } }),
  defineEvent({
    name: "auth.scope.denied",
    kind: "auth",
    level: "warn",
    description: "Una identidad autenticada no tiene el permiso (scope) que exige la operación.",
    attrs: { scope: code(), operation: code() },
  }),

  defineEvent({
    name: "whatsapp.link", kind: "auth", description: "Estado del vínculo de WhatsApp, sin números ni códigos.",
    attrs: { action: z.enum(["started", "detected", "invalid_code", "confirmed", "unlinked"]) },
  }),
  defineEvent({
    name: "whatsapp.request", kind: "tool", description: "Solicitud de Sideband creada o consultada por WhatsApp.",
    attrs: { action: z.enum(["ask", "status"]), decision: code(), tool: code() },
  }),
  defineEvent({
    name: "whatsapp.send", kind: "http", description: "Envío de una respuesta por Kapso, sin el contenido ni el destinatario.",
    attrs: {},
  }),
  defineEvent({
    name: "whatsapp.interpret", kind: "http", description: "Interpretación en Claude, sin guardar texto ni destinatario.",
    attrs: { action: z.enum(["ask", "status", "help"]) },
  }),
  defineEvent({
    name: "web.invite.progress",
    kind: "lifecycle",
    description: "Paso observado en el alta por invitación de Sideband.",
    attrs: { step: z.enum(["opened", "sign_in", "claim_address", "address_claimed", "connect"]) },
  }),
  defineEvent({
    name: "web.agent.ping",
    kind: "lifecycle",
    description: "Inicio o resultado de una prueba de conexión desde la app web.",
    attrs: { stage: z.enum(["started", "finished"]), outcome: code(), verified: bool() },
  }),

  defineEvent({
    name: "mcp.tool.call",
    kind: "tool",
    description: "Llamada a una tool del MCP de Sideband.",
    attrs: { tool: code(), outcome: z.enum(["ok", "error", "denied"]) },
  }),
  defineEvent({
    name: "broker.policy.evaluated",
    kind: "policy",
    description: "Resultado de la política bilateral.",
    attrs: { tool: code(), category: code(), decision: z.enum(["allow", "deny", "ask_owner"]), rule: code() },
  }),
  defineEvent({
    name: "broker.request.created",
    kind: "lifecycle",
    description: "Solicitud creada en el broker.",
    attrs: { tool: code(), rule: code(), targetAgentId: id() },
  }),
  defineEvent({
    name: "broker.request.status_changed",
    kind: "lifecycle",
    description: "Transición de estado de una solicitud.",
    attrs: { from: code(), to: code(), by: z.enum(["agent", "owner", "broker", "admin"]) },
  }),
  defineEvent({
    name: "broker.request.closed",
    kind: "lifecycle",
    description: "Solicitud cerrada en su estado final.",
    attrs: { outcome: code(), escalated: bool() },
  }),
  defineEvent({
    name: "broker.reply.rejected",
    kind: "lifecycle",
    level: "warn",
    description: "Respuesta de agente rechazada.",
    // leak_blocked: sanitizeReply bloqueó la respuesta; flags lleva solo códigos `etapa:código`, nunca texto.
    attrs: {
      code: z.enum(["nonce", "expired", "schema", "not_recipient", "closed", "leak_blocked"]),
      flags: codes(),
    },
  }),
  defineEvent({
    name: "broker.reply.sanitized",
    kind: "lifecycle",
    description: "sanitizeReply aceptó la respuesta del agente pero descartó campos o marcó hallazgos.",
    attrs: { flags: codes(), dropped: codes() },
  }),
  defineEvent({ name: "broker.owner.decided", kind: "lifecycle", description: "El dueño decidió una solicitud escalada.", attrs: { decision: code() } }),
  defineEvent({
    name: "broker.grant.set",
    kind: "policy",
    description: "El titular dio un permiso. Sin la dirección autorizada: solo el id y la categoría.",
    attrs: { grantId: id(), category: code() },
  }),
  defineEvent({ name: "broker.grant.revoked", kind: "policy", description: "El dueño revocó un permiso.", attrs: { grantId: id() } }),
  defineEvent({ name: "broker.contact.connected", kind: "policy", description: "Dos titulares quedaron conectados al aceptar una invitación.", attrs: {} }),
  defineEvent({ name: "broker.contact.removed", kind: "policy", description: "Un titular terminó una conexión en ambos sentidos.", attrs: {} }),
  defineEvent({
    name: "broker.circle.changed",
    kind: "policy",
    description: "Cambió un círculo o su membresía. Sin direcciones: solo el id del círculo y la acción.",
    attrs: { circleId: id(), action: z.enum(["created", "deleted", "invited", "joined", "removed"]) },
  }),

  defineEvent({
    name: "wake.attempt",
    kind: "wake",
    description: "Intento de aviso a un agente.",
    attrs: { kind: code(), attempt: int(), ok: bool(), httpStatus: int(), code: code() },
  }),
  defineEvent({ name: "wake.exhausted", kind: "wake", level: "warn", description: "Se agotaron los intentos de aviso.", attrs: { kind: code(), attempts: int() } }),
  defineEvent({ name: "wake.lease_recovered", kind: "wake", level: "warn", description: "El worker retomó un aviso cuya concesión venció.", attrs: { attempt: int() } }),
  defineEvent({ name: "wake.callback_verification", kind: "wake", description: "Resultado de la verificación de un callback MCP.", attrs: { ok: bool(), reason: code() } }),

  defineEvent({
    name: "demo.contact.seeded",
    kind: "lifecycle",
    description: "Preparación de una identidad ficticia para el broker local de Contactos de Ana.",
    attrs: { action: z.enum(["grants", "address", "wake"]) },
  }),
  defineEvent({
    name: "coordination.tool.call",
    kind: "tool",
    description: "Llamada a una tool del servidor de coordinación.",
    attrs: { tool: code(), outcome: code() },
  }),

  defineEvent({
    name: "error",
    kind: "error",
    level: "error",
    description: "Error capturado con telemetry.error(). Nunca incluye el mensaje crudo: solo tipo, códigos y frames del repo.",
    attrs: {
      operation: z.string().min(1).max(200),
      type: code(),
      // Códigos de issues de zod separados por coma.
      issues: z.string().max(512),
      // Frames del repo (apps/… o packages/…), uno por línea.
      frames: z.string().max(2048),
      // Código de sistema o de Postgres (ECONNREFUSED, 23505…), si existe.
      code: code(),
    },
  }),

  defineEvent({ name: "admin.login", kind: "admin", description: "Inicio de sesión en el admin.", attrs: adminAttrs }),
  defineEvent({ name: "admin.logout", kind: "admin", description: "Cierre de sesión en el admin.", attrs: adminAttrs }),
  defineEvent({ name: "admin.reveal", kind: "admin", level: "warn", description: "Un operator reveló un payload.", attrs: adminAttrs }),
  defineEvent({ name: "admin.action", kind: "admin", level: "warn", description: "Acción de operador en el broker.", attrs: adminAttrs }),
  defineEvent({ name: "admin.token.created", kind: "admin", description: "Token sba_ creado.", attrs: adminAttrs }),
  defineEvent({ name: "admin.token.revoked", kind: "admin", description: "Token sba_ revocado.", attrs: adminAttrs }),
  defineEvent({ name: "admin.mcp.call", kind: "admin", description: "Llamada al MCP de administración.", attrs: adminAttrs }),

  defineEvent({
    name: "telemetry.invalid_event",
    kind: "lifecycle",
    level: "warn",
    description: "Un emit() no pasó el esquema del catálogo. El evento se guardó sin attrs.",
    attrs: { event: code(), issues: z.string().max(512) },
  }),
] as const;

export type Catalog = typeof catalog;
export type CatalogEvent = Catalog[number];
export type EventName = CatalogEvent["name"];
export type EventDef<N extends EventName> = Extract<CatalogEvent, { name: N }>;
/** Atributos que acepta un evento (todos opcionales). */
export type EventAttrs<N extends EventName> = z.input<EventDef<N>["attrs"]>;

/** Campos de emit(): ids de correlación, nivel/status opcionales y attrs del catálogo. */
export interface EventFields<N extends EventName = EventName> {
  requestId?: string | null;
  userId?: string | null;
  agentId?: string | null;
  level?: Level;
  status?: string | null;
  durationMs?: number | null;
  attrs?: EventAttrs<N>;
}

const byName = new Map<string, CatalogEvent>(catalog.map((event) => [event.name, event]));

export function getEventDefinition(name: string): CatalogEvent | undefined {
  return byName.get(name);
}

export interface CatalogEntry {
  name: string;
  kind: EventKind;
  level: Level;
  description: string;
  attrs: string[];
  schema: unknown;
}

/** Catálogo serializable (JSON Schema de attrs). Lo publica el MCP admin en admin://schema. */
export function describeCatalog(): CatalogEntry[] {
  return catalog.map((event) => ({
    name: event.name,
    kind: event.kind,
    level: event.level,
    description: event.description,
    attrs: Object.keys(event.attrs.shape),
    schema: z.toJSONSchema(event.attrs),
  }));
}
