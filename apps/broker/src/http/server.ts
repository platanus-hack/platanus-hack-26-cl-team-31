import { BrokerError, type BrokerCore } from "@team-31/broker";
import { ErrorBody, httpStatusOf } from "@team-31/protocol";
import { routes } from "@team-31/protocol/http";
import { silentTelemetry, type Telemetry } from "@team-31/telemetry";
import { honoTelemetry } from "@team-31/telemetry/hono";
import { Hono, type Context } from "hono";
import { routePath } from "hono/route";
import type { z } from "zod";
import { requireServiceIdentity, type AuthContext, type ServiceKeys } from "./auth.js";
import { createMemoryRateLimiter, rateLimitError, type RateLimiter } from "./rate-limit.js";
import { ownerStream } from "./stream.js";

type Route = (typeof routes)[keyof typeof routes];
type HttpContext = Context<AuthContext>;

function parseInput<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success) throw new BrokerError("invalid_input", "La solicitud no cumple el formato requerido.");
  return result.data;
}

async function parseBody<S extends z.ZodType>(c: HttpContext, schema: S): Promise<z.output<S>> {
  let value: unknown;
  try {
    value = await c.req.json();
  } catch {
    throw new BrokerError("invalid_input", "El cuerpo debe ser JSON válido.");
  }
  return parseInput(schema, value);
}

async function callPort(route: Exclude<Route, { port: null }>, c: HttpContext, { agent, owner, admin }: BrokerCore) {
  switch (route.port) {
    case "agent.vaultCatalog": return agent.vaultCatalog(c.get("mcp"));
    case "agent.changeVault": return agent.changeVault(c.get("mcp"), await parseBody(c, route.body));
    case "agent.queryVault": return agent.queryVault(c.get("mcp"), await parseBody(c, route.body));
    case "owner.vault": return owner.vault(c.get("web"));
    case "owner.changeVault": return owner.changeVault(c.get("web"), await parseBody(c, route.body));
    case "agent.capabilities":
      return agent.capabilities(c.get("mcp"), parseInput(route.query, c.req.query()).to);
    case "agent.ask":
      return agent.ask(c.get("mcp"), await parseBody(c, route.body));
    case "agent.inbox":
      return { items: await agent.inbox(c.get("mcp"), parseInput(route.query, c.req.query()).includeInvitations === "true") };
    case "agent.reply":
      return agent.reply(c.get("mcp"), await parseBody(c, route.body));
    case "agent.contacts":
      return agent.contacts(c.get("mcp"));
    case "agent.status":
      return agent.status(c.get("mcp"), parseInput(route.params, c.req.param()).id);
    case "agent.connectWake":
      return agent.connectWake(c.get("mcp"), await parseBody(c, route.body));
    case "agent.disconnectWake":
      return agent.disconnectWake(c.get("mcp"), parseInput(route.params, c.req.param()).subscriptionId);
    case "owner.me":
      return owner.me(c.get("web"));
    case "owner.claimAddress":
      return { address: await owner.claimAddress(c.get("web"), (await parseBody(c, route.body)).localPart) };
    case "owner.grants":
      return { items: await owner.grants(c.get("web")) };
    case "owner.setGrant":
      return owner.setGrant(c.get("web"), await parseBody(c, route.body));
    case "owner.revokeGrant":
      return owner.revokeGrant(c.get("web"), parseInput(route.params, c.req.param()).id);
    case "owner.pending":
      return { items: await owner.pending(c.get("web")) };
    case "owner.activity":
      return { items: await owner.activity(c.get("web"), parseInput(route.query, c.req.query()).limit) };
    case "owner.ask":
      return owner.ask(c.get("web"), await parseBody(c, route.body));
    case "owner.channelAsk":
      return owner.ask(c.get("web"), await parseBody(c, route.body), parseInput(route.params, c.req.param()).name);
    case "owner.setChannel":
      return owner.setChannel(c.get("web"), parseInput(route.params, c.req.param()).name, await parseBody(c, route.body));
    case "owner.status":
      return owner.status(c.get("web"), parseInput(route.params, c.req.param()).id);
    case "owner.decide":
      return owner.decide(c.get("web"), parseInput(route.params, c.req.param()).id, await parseBody(c, route.body));
    case "owner.agentDirectory":
      return { items: await owner.agentDirectory(c.get("web")) };
    case "owner.agents":
      return { items: await owner.agents(c.get("web")) };
    case "owner.setWake":
      return owner.setWake(c.get("web"), parseInput(route.params, c.req.param()).agentId, await parseBody(c, route.body));
    case "owner.ping":
      return owner.ping(c.get("web"), parseInput(route.params, c.req.param()).agentId);
    case "owner.revokeAgent":
      return owner.revokeAgent(c.get("web"), parseInput(route.params, c.req.param()).agentId);
    case "owner.connect": {
      const { to, share, tag } = await parseBody(c, route.body);
      return owner.connect(c.get("web"), to, share, tag);
    }
    case "owner.contacts":
      return owner.contacts(c.get("web"));
    case "owner.setSharing":
      return owner.setSharing(c.get("web"), parseInput(route.params, c.req.param()).address, await parseBody(c, route.body));
    case "owner.setContactTag":
      return owner.setContactTag(c.get("web"), parseInput(route.params, c.req.param()).address, (await parseBody(c, route.body)).tag);
    case "owner.setTagPreset":
      return owner.setTagPreset(c.get("web"), parseInput(route.params, c.req.param()).tag, await parseBody(c, route.body));
    case "owner.answerInvitation":
      return owner.answerInvitation(c.get("web"), parseInput(route.params, c.req.param()).id, await parseBody(c, route.body));
    case "owner.circles":
      return { items: await owner.circles(c.get("web")) };
    case "owner.createCircle":
      return owner.createCircle(c.get("web"), (await parseBody(c, route.body)).name);
    case "owner.deleteCircle":
      return owner.deleteCircle(c.get("web"), parseInput(route.params, c.req.param()).id);
    case "owner.inviteToCircle": {
      const { id, address } = parseInput(route.params, c.req.param());
      return owner.inviteToCircle(c.get("web"), id, address);
    }
    case "owner.joinCircle":
      return owner.joinCircle(c.get("web"), parseInput(route.params, c.req.param()).id);
    case "owner.removeFromCircle": {
      const { id, address } = parseInput(route.params, c.req.param());
      return owner.removeFromCircle(c.get("web"), id, address);
    }
    case "owner.removeFriend":
      return owner.removeFriend(c.get("web"), parseInput(route.params, c.req.param()).address);
    case "admin.rewake":
      return admin.rewake(c.get("admin"), parseInput(route.params, c.req.param()).id, (await parseBody(c, route.body)).reason);
    case "admin.expire":
      return admin.expire(c.get("admin"), parseInput(route.params, c.req.param()).id, (await parseBody(c, route.body)).reason);
    case "admin.revokeAgent": {
      const { userId, agentId } = parseInput(route.params, c.req.param());
      return admin.revokeAgent(c.get("admin"), userId, agentId, (await parseBody(c, route.body)).reason);
    }
  }
}

// Ports that create a request share the ask rate-limit bucket.
const askPorts: readonly (string | null)[] = ["agent.ask", "owner.ask", "owner.channelAsk"];

// Correlates the http.request span with the request it touched (ids only, never the payload).
function requestIdOf(c: HttpContext, result: unknown): string | undefined {
  const fromResult = typeof result === "object" && result !== null ? (result as { requestId?: unknown }).requestId : undefined;
  if (typeof fromResult === "string") return fromResult;
  return c.req.param("id");
}

export function createHttpServer({ broker, publicKeys, limiter = createMemoryRateLimiter(), shutdown, telemetry = silentTelemetry("broker") }: {
  broker: BrokerCore;
  publicKeys: ServiceKeys;
  limiter?: RateLimiter;
  shutdown?: AbortSignal;
  telemetry?: Telemetry;
}) {
  const app = new Hono<AuthContext>();
  app.use(honoTelemetry(telemetry));
  const auth = {
    mcp: requireServiceIdentity("mcp", publicKeys, telemetry),
    web: requireServiceIdentity("web", publicKeys, telemetry),
    admin: requireServiceIdentity("admin", publicKeys, telemetry),
  };

  for (const route of Object.values(routes)) {
    app.on([route.method], [route.path], ...(route.iss ? [auth[route.iss]] : []), async (c: HttpContext) => {
      if (route.iss) {
        const bucket = askPorts.includes(route.port) ? "ask" : route.port === "agent.reply" ? "reply" : "other";
        const caller = route.iss === "admin" ? `admin:${c.get("admin").adminId}` : c.get(route.iss).userId;
        const blocked = await limiter.consume(caller, bucket);
        if (blocked) {
          telemetry.emit("http.rate_limited", { attrs: { route: route.path, bucket } });
          c.header("Retry-After", String(blocked.retryAfter));
          throw rateLimitError();
        }
      }
      if ("contentType" in route) return ownerStream(c, broker.owner, route.response, telemetry, shutdown);

      const result = route.port === null ? { ok: true } : await callPort(route, c, broker);
      const requestId = requestIdOf(c, result);
      if (requestId) telemetry.identify({ requestId });
      const response = route.response.parse(result);
      if ("status" in route) return c.body(null, route.status);
      return c.json(response);
    });
  }

  app.notFound((c) => c.json(ErrorBody.parse({ error: { code: "not_found", message: "No se encontró la ruta." } }), 404));
  app.onError((error, c) => {
    if (error instanceof BrokerError && error.code !== "internal") {
      const { code, message, reason, errorId } = error;
      if (code === "unauthorized") c.header("WWW-Authenticate", "Bearer");
      // An expected domain error is not an internal error: the span keeps its 4xx status.
      if (errorId) c.header("X-Error-Id", errorId);
      c.error = undefined;
      return c.json(ErrorBody.parse({ error: { code, message, ...(reason ? { reason } : {}) } }), httpStatusOf(code));
    }
    c.header("X-Error-Id", telemetry.error(`${c.req.method} ${routePath(c)}`, error));
    return c.json(ErrorBody.parse({ error: { code: "internal", message: "Ocurrió un error interno en el broker." } }), 500);
  });
  return app;
}

// Tests and embedded uses may omit telemetry: the server stays instrumented without writing anywhere.
