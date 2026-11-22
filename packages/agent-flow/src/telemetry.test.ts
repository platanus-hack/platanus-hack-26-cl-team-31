import { describe, expect, it } from "vitest";

import { BROKER, type FlowActor, type FlowEvent } from "./model.js";
import { scenarioEvents, scenarioRows } from "./scenario.js";
import { createFlowDirectory, createTelemetryMapper, flowAttrKeys, flowEventNames, isFlowRow, ownerLabel, projectFlowRow, type TelemetryRow } from "./telemetry.js";

const directory = () =>
  createFlowDirectory({
    users: [
      { userId: "u1", address: "ana@sideband.app", displayName: "Ana" },
      { userId: "u2", address: "bob@sideband.app", displayName: "Bob" },
    ],
    agents: [
      { agentId: "a1", userId: "u1", label: "Claude Code", kind: "mcp_events" },
      { agentId: "b1", userId: "u2", label: "Grok Bot", kind: "grokbot_routine" },
    ],
    requests: [{ id: "r1", fromAddress: "ana@sideband.app", toAddress: "bob@sideband.app" }],
  });

let seq = 0;
const row = (name: string, fields: Partial<TelemetryRow> = {}): TelemetryRow => ({
  id: String(++seq),
  at: 1_000 + seq * 10,
  service: name.startsWith("mcp") ? "mcp" : name.startsWith("wake") ? "worker" : "broker",
  name,
  requestId: "r1",
  attrs: {},
  ...fields,
});

const actor = (endpoint: FlowEvent["from"]) => (endpoint === BROKER ? BROKER : (endpoint as FlowActor).id);
const steps = (events: FlowEvent[]) => events.map((e) => `${e.step}:${e.status}:${actor(e.from)}>${actor(e.to)}`);

describe("createTelemetryMapper", () => {
  it("keeps two people using the same OAuth client on separate routes", () => {
    const dir = directory();
    dir.add({ agents: [
      { userId: "u1", agentId: "shared", kind: "openclaw_hooks" },
      { userId: "u2", agentId: "shared", kind: "grokbot_routine" },
    ] });
    const mapper = createTelemetryMapper(dir);
    const [ask] = mapper.map(row("broker.policy.evaluated", { userId: "u1", agentId: "shared" }));
    const [wake] = mapper.map(row("wake.attempt", { userId: "u2", agentId: "shared" }));
    expect(ask?.from).toMatchObject({ id: "agent:u1:shared", label: "OpenClaw", owner: { label: "Ana" } });
    expect(wake?.to).toMatchObject({ id: "agent:u2:shared", label: "Grok Bot", owner: { label: "Bob" } });
    expect(mapper.map(row("wake.attempt", { userId: "u1", agentId: "shared" }))).toEqual([]);
  });

  it("draws an allowed request end to end with the agents of each side", () => {
    const mapper = createTelemetryMapper(directory());
    const events = [
      row("broker.policy.evaluated", { userId: "u1", agentId: "a1", attrs: { tool: "availability", category: "availability", decision: "allow", rule: "grant" } }),
      row("broker.request.created", { userId: "u1", agentId: "a1", attrs: { tool: "availability", rule: "grant" } }),
      row("mcp.tool.call", { userId: "u1", agentId: "a1", durationMs: 30, attrs: { tool: "sideband_ask", outcome: "ok" } }),
      row("wake.attempt", { userId: "u2", agentId: "b1", durationMs: 5, attrs: { kind: "standard_webhook", attempt: 1, ok: true, httpStatus: 200 } }),
      row("broker.request.status_changed", { attrs: { from: "awaiting_agent", to: "answered", by: "agent" } }),
      row("mcp.tool.call", { userId: "u2", agentId: "b1", attrs: { tool: "sideband_reply", outcome: "ok" } }),
      row("broker.request.closed", { attrs: { outcome: "answered", escalated: false } }),
    ].flatMap((r) => mapper.map(r));

    expect(steps(events)).toEqual([
      "ask:pending:agent:u1:a1>broker",
      "policy:allowed:broker>broker",
      "request:ok:broker>broker",
      "wake:ok:broker>agent:u2:b1",
      "reply:ok:agent:u2:b1>broker",
      "delivered:delivered:broker>agent:u1:a1",
    ]);
    const ask = events[0]!.from as FlowActor;
    expect(ask).toMatchObject({ label: "Claude Code", channel: "MCP", owner: { key: "ana@sideband.app", label: "Ana" } });
    expect(events[1]!.meta).toMatchObject({ tool: "availability", category: "availability", decision: "allow", rule: "grant" });
    expect(events.every((e) => e.requestId === "r1")).toBe(true);
  });

  it("draws the ask from the MCP span when it arrives first and does not repeat it", () => {
    const mapper = createTelemetryMapper(directory());
    const events = [
      row("mcp.tool.call", { userId: "u1", agentId: "a1", attrs: { tool: "sideband_ask", outcome: "ok" } }),
      row("broker.policy.evaluated", { userId: "u1", agentId: "a1", attrs: { tool: "question", category: "health", decision: "deny", rule: "no_grant" } }),
    ].flatMap((r) => mapper.map(r));
    expect(steps(events)).toEqual(["ask:pending:agent:u1:a1>broker", "policy:denied:broker>broker"]);
  });

  it("closes a denied request with a signed denial and no wake", () => {
    const mapper = createTelemetryMapper(directory());
    const events = [
      row("broker.policy.evaluated", { userId: "u1", agentId: "a1", attrs: { tool: "question", category: "health", decision: "deny", rule: "no_grant" } }),
      row("broker.request.closed", { attrs: { outcome: "denied", escalated: false } }),
    ].flatMap((r) => mapper.map(r));
    expect(steps(events)).toEqual(["ask:pending:agent:u1:a1>broker", "policy:denied:broker>broker", "delivered:denied:broker>agent:u1:a1"]);
  });

  it("marks a leak_blocked reply as blocked with its codes and a sanitized reply with dropped fields", () => {
    const mapper = createTelemetryMapper(directory());
    mapper.map(row("wake.attempt", { userId: "u2", agentId: "b1", attrs: { ok: true, attempt: 1 } }));
    const [blocked] = mapper.map(row("broker.reply.rejected", { attrs: { code: "leak_blocked", flags: "leak-guard:leak_email,leak-guard:leak_phone" } }));
    const [sanitized] = mapper.map(row("broker.reply.sanitized", { attrs: { flags: "redact:redacted", dropped: "freeSlots,note" } }));
    expect(blocked).toMatchObject({ step: "reply_blocked", status: "blocked", meta: { code: "leak_blocked", flags: ["leak-guard:leak_email", "leak-guard:leak_phone"] } });
    expect(actor(blocked!.from)).toBe("agent:u2:b1");
    expect(sanitized).toMatchObject({ step: "sanitized", status: "sanitized", meta: { flags: ["redact:redacted"], fieldsDropped: ["freeSlots", "note"] } });
  });

  it("escalates to the recipient's owner and shows the owner's decision", () => {
    const mapper = createTelemetryMapper(directory());
    const events = [
      row("broker.request.status_changed", { attrs: { from: "awaiting_agent", to: "awaiting_owner", by: "agent" } }),
      row("broker.owner.decided", { userId: "u2", attrs: { decision: "approve_once" } }),
      row("broker.request.status_changed", { attrs: { from: "awaiting_owner", to: "answered", by: "owner" } }),
    ].flatMap((r) => mapper.map(r));
    expect(steps(events)).toEqual([
      "reply:ok:agent@bob@sideband.app>broker",
      "escalated:escalated:broker>owner@bob@sideband.app",
      "owner_decided:allowed:owner@bob@sideband.app>broker",
    ]);
  });

  it("starts spans at their beginning and keeps their latency", () => {
    const mapper = createTelemetryMapper(directory());
    const [wake] = mapper.map(row("wake.attempt", { at: 5_000, durationMs: 900, agentId: "b1", attrs: { ok: false, attempt: 1, httpStatus: 503 } }));
    expect(wake).toMatchObject({ at: 4_100, status: "failed", meta: { latencyMs: 900, httpStatus: 503, attempt: 1 } });
  });

  it("reads the demo MCP (coordination.tool.call) only for ask and check", () => {
    const mapper = createTelemetryMapper(directory());
    expect(mapper.map(row("coordination.tool.call", { requestId: "r9", userId: "u1", attrs: { tool: "ask_contact", outcome: "ok" } }))).toMatchObject([{ step: "ask" }]);
    expect(mapper.map(row("coordination.tool.call", { requestId: null, userId: "u1", attrs: { tool: "availability_check", outcome: "ok" } }))).toEqual([]);
  });

  it("ignores events outside the flow", () => {
    const mapper = createTelemetryMapper(directory());
    for (const name of ["http.request", "service.heartbeat", "auth.token.verified", "error", "broker.grant.set"]) {
      expect(mapper.map(row(name, { attrs: { route: "/v1/agent/ask", status: 200 } }))).toEqual([]);
    }
  });

  it("never copies attributes outside its allowlist", () => {
    const mapper = createTelemetryMapper(directory());
    const secret = "texto-secreto-de-un-tercero";
    const attrs = { args: secret, result: secret, text: secret, purpose: secret, nonce: secret, authorization: secret, token: secret };
    const events = [
      row("broker.policy.evaluated", { userId: "u1", attrs: { ...attrs, tool: "question", decision: "allow", rule: "grant" } }),
      row("wake.attempt", { attrs: { ...attrs, ok: true } }),
      row("broker.reply.rejected", { attrs: { ...attrs, code: "leak_blocked" } }),
      row("broker.request.status_changed", { attrs: { ...attrs, from: "awaiting_agent", to: "answered", by: "agent" } }),
      row("broker.request.closed", { attrs: { ...attrs, outcome: "answered" } }),
      row("mcp.tool.call", { attrs: { ...attrs, tool: "sideband_inbox", outcome: "ok" } }),
    ].flatMap((r) => mapper.map(r));
    expect(events.length).toBeGreaterThan(0);
    expect(JSON.stringify(events)).not.toContain(secret);
  });

  it("falls back to a placeholder agent when the directory does not know the request", () => {
    const mapper = createTelemetryMapper(createFlowDirectory());
    const [ask] = mapper.map(row("broker.policy.evaluated", { requestId: "zz", userId: "user-1234567890", attrs: { decision: "allow" } }));
    expect(ask!.from).toMatchObject({ id: "agent@user:user-1234567890", placeholder: true, owner: { label: "user-123…" } });
  });
});

describe("scenario", () => {
  it("maps every row through the same telemetry mapper and covers each status", () => {
    const events = scenarioEvents();
    expect(scenarioRows().length).toBeGreaterThan(20);
    const statuses = new Set(events.map((e) => e.status));
    for (const status of ["pending", "allowed", "denied", "blocked", "sanitized", "escalated", "delivered", "expired", "failed"] as const) {
      expect(statuses, status).toContain(status);
    }
    const owners = new Set(events.flatMap((e) => [e.from, e.to]).filter((e) => e !== BROKER).map((e) => (e as FlowActor).owner.label));
    expect([...owners].sort()).toEqual(["Ana", "Bob", "Carla", "Dani", "Fran", "Gabi", "Hugo", "Inés"]);
    // Orden estable por tiempo.
    expect(events.map((e) => e.at)).toEqual([...events.map((e) => e.at)].sort((a, b) => a - b));
  });

  it("never wakes the recipient of a denied request", () => {
    const denied = scenarioEvents().filter((e) => e.requestId === "req-ana-carla");
    expect(denied.map((e) => e.step)).toEqual(["ask", "policy", "request", "delivered"]);
    expect(denied.at(-1)).toMatchObject({ status: "denied" });
  });
});

describe("presence mapping", () => {
  it("keeps directory order for owners and their active agents in a snapshot", () => {
    const dir = createFlowDirectory({
      users: [{ userId: "u1" }, { userId: "u2" }, { userId: "u3", address: "luz@sideband.app" }],
      agents: [
        { agentId: "b1", userId: "u2" },
        { agentId: "a2", userId: "u1" },
        { agentId: "old", userId: "u1", revokedAt: "2026-01-01" },
        { agentId: "a1", userId: "u1" },
        { agentId: "unassigned" },
      ],
    });

    const snapshot = createTelemetryMapper(dir).snapshot(5);
    expect(snapshot.map((event) => actor(event.from))).toEqual([
      "agent:u1:a2", "agent:u1:a1", "agent:u2:b1", "agent@luz@sideband.app",
    ]);
  });

  it("builds the initial network and maps MCP calls", () => {
    const dir = createFlowDirectory({
      users: [
        { userId: "u1", address: "ana@sideband.app", displayName: "Ana" },
        { userId: "u3", address: "luz@sideband.app", displayName: "Luz" },
      ],
      agents: [
        { agentId: "a1", userId: "u1", label: "Claude Code", kind: "mcp_events" },
        { agentId: "old", userId: "u1", label: "Viejo", kind: "mcp_events", revokedAt: "2026-01-01T00:00:00Z" },
      ],
    });
    dir.add({ users: [{ userId: "u5", address: "vera@sideband.app" }], agents: [{ agentId: "v1", userId: "u5", revokedAt: "2026-11-21T00:00:00Z" }] });
    const mapper = createTelemetryMapper(dir);
    const snapshot = mapper.snapshot(5);
    // Vera solo tenía un agente revocado: ya salió, no vuelve como provisional.
    expect(snapshot.map((e) => `${e.step}:${actor(e.from)}`)).toEqual(["joined:agent:u1:a1", "joined:agent@luz@sideband.app"]);
    expect(snapshot.every((e) => e.meta.snapshot)).toBe(true);
    // a1 ya estaba en la foto: su llamada no repite la entrada.
    expect(mapper.map(row("mcp.tool.call", { requestId: null, userId: "u1", agentId: "a1", attrs: { tool: "sideband_inbox", outcome: "ok" } })).map((e) => e.step)).toEqual(["inbox"]);
  });
});

describe("live edge cases", () => {
  it("maps a repeated row (reconnect, server lookback) only once", () => {
    const mapper = createTelemetryMapper(directory());
    const policy = row("broker.policy.evaluated", { userId: "u1", agentId: "a1", attrs: { tool: "question", category: "general", decision: "deny", rule: "no_grant" } });
    expect(mapper.map(policy).map((e) => e.step)).toEqual(["ask", "policy"]);
    expect(mapper.map({ ...policy })).toEqual([]);
  });

  it("attributes a close that arrives before the policy row to the requester from the request summary", () => {
    const mapper = createTelemetryMapper(directory());
    const closed = mapper.map(row("broker.request.closed", { attrs: { outcome: "denied", escalated: false } }));
    expect(closed).toMatchObject([{ step: "delivered", status: "denied", to: { owner: { key: "ana@sideband.app" } } }]);
  });

  it("maps broker.agent.connected and broker.agent.revoked to joined and left", () => {
    const dir = directory();
    const mapper = createTelemetryMapper(dir);
    dir.add({ agents: [{ agentId: "c1", userId: "u2", label: "OpenClaw", kind: "openclaw_hooks" }] });
    const joined = mapper.map(row("broker.agent.connected", { requestId: null, userId: "u2", agentId: "c1", attrs: { kind: "none" } }));
    expect(joined).toMatchObject([{ step: "joined", status: "ok", from: { id: "agent:u2:c1", label: "OpenClaw", owner: { label: "Bob" } } }]);
    const left = mapper.map(row("broker.agent.revoked", { requestId: null, userId: "u2", agentId: "c1", attrs: { by: "admin" } }));
    expect(left).toMatchObject([{ step: "left", status: "expired", meta: { by: "admin" } }]);
    // Sin ids no hay a quién mover.
    expect(mapper.map(row("broker.agent.connected", { requestId: null, attrs: {} }))).toEqual([]);
  });

  it("reconciles a refreshed directory: revoked agents leave, new agents join, once", () => {
    const dir = createFlowDirectory({
      users: [{ userId: "u1", address: "ana@sideband.app" }, { userId: "u2", address: "bob@sideband.app" }],
      agents: [{ agentId: "a1", userId: "u1", label: "Claude Code" }],
    });
    const mapper = createTelemetryMapper(dir);
    mapper.snapshot(1);
    dir.add({ agents: [{ agentId: "a1", userId: "u1", label: "Claude Code", revokedAt: "2026-11-21T00:00:00Z" }, { agentId: "b1", userId: "u2", label: "Codex" }] });
    expect(mapper.reconcile(2).map((e) => `${e.step}:${actor(e.from)}`)).toEqual(["left:agent:u1:a1", "joined:agent:u2:b1"]);
    expect(mapper.reconcile(3)).toEqual([]);
    dir.add({ agents: [{ agentId: "a1", userId: "u1", label: "Claude Code", revokedAt: null }] });
    expect(mapper.reconcile(4).map((e) => `${e.step}:${actor(e.from)}`)).toEqual(["joined:agent:u1:a1"]);
    expect(mapper.reconcile(5)).toEqual([]);
  });

  it("only draws provisional agents for owners with no connection history", () => {
    const dir = createFlowDirectory({ users: [
      { userId: "u1", address: "ana@sideband.app", hasAgentHistory: true },
      { userId: "u2", address: "bob@sideband.app", hasAgentHistory: false },
    ] });
    expect(createTelemetryMapper(dir).snapshot(1).map((e) => actor(e.from))).toEqual(["agent@bob@sideband.app"]);
  });

  it("adds eligible new placeholders once when the directory refreshes", () => {
    const dir = createFlowDirectory();
    const mapper = createTelemetryMapper(dir);
    expect(mapper.snapshot(1)).toEqual([]);
    dir.add({ users: [
      { userId: "u1", address: "ana@sideband.app" },
      { userId: "u2", address: "bob@sideband.app", hasAgentHistory: true },
      { userId: "u3" },
      { userId: "u4", address: "vera@sideband.app" },
    ], agents: [{ userId: "u4", agentId: "old", revokedAt: "2026-01-01" }] });
    expect(mapper.reconcile(2)).toMatchObject([
      { step: "joined", from: { id: "agent@ana@sideband.app", placeholder: true }, meta: { snapshot: true } },
    ]);
    expect(mapper.reconcile(3)).toEqual([]);
  });

  it("relabels an agent drawn before its owner reached the directory, without animation", () => {
    const dir = createFlowDirectory();
    const mapper = createTelemetryMapper(dir);
    const [joined] = mapper.map(row("broker.agent.connected", { requestId: null, userId: "u7", agentId: "z7", attrs: {} }));
    expect((joined!.from as FlowActor).owner.label).toBe("u7");
    dir.add({ users: [{ userId: "u7", address: "demo-zoe@sideband.app" }], agents: [{ agentId: "z7", userId: "u7", label: "Claude Code" }] });
    const fixed = mapper.reconcile(9);
    expect(fixed).toMatchObject([{ step: "joined", meta: { snapshot: true }, from: { label: "Claude Code", owner: { key: "demo-zoe@sideband.app", label: "Zoe" } } }]);
    expect(mapper.reconcile(10)).toEqual([]);
  });

  it("reports ids missing from the directory so the host can refresh it", () => {
    const mapper = createTelemetryMapper(directory());
    mapper.map(row("broker.agent.connected", { requestId: null, userId: "u9", agentId: "z9", attrs: {} }));
    expect(mapper.takeUnknown()).toEqual({ users: ["u9"], agents: ["z9"] });
    expect(mapper.takeUnknown()).toEqual({ users: [], agents: [] });
  });

  it("names owners by display name or by the readable local part of their address", () => {
    expect(ownerLabel("demo-ana@sideband.app")).toBe("Ana");
    expect(ownerLabel("test-maria_jose@sideband.app")).toBe("Maria Jose");
    expect(ownerLabel("bob@sideband.app", "Roberto")).toBe("Roberto");
    expect(ownerLabel("demo-@sideband.app")).toBe("demo-");
    expect(ownerLabel(null)).toBe("Sin identificar");
    const mapper = createTelemetryMapper(createFlowDirectory({ users: [{ userId: "d1", address: "demo-luz@sideband.app" }], agents: [{ agentId: "x", userId: "d1" }] }));
    expect(mapper.snapshot(1)[0]!.from).toMatchObject({ owner: { key: "demo-luz@sideband.app", label: "Luz" } });
  });

  it("projects rows to the attributes the mapper reads and filters coordination tools", () => {
    const leaky = row("broker.reply.rejected", {
      attrs: { code: "leak_blocked", flags: "leak-guard:private_hint", args: "{secret}", result: "x", text: "hola", nonce: "n", token: "t" },
    });
    expect(projectFlowRow(leaky).attrs).toEqual({ code: "leak_blocked", flags: "leak-guard:private_hint" });
    expect(projectFlowRow(row("http.request", { attrs: { route: "/x" } })).attrs).toEqual({});
    expect(isFlowRow(row("coordination.tool.call", { attrs: { tool: "ask_contact" } }))).toBe(true);
    expect(isFlowRow(row("coordination.tool.call", { attrs: { tool: "meeting_propose" } }))).toBe(false);
    expect(isFlowRow(row("http.request"))).toBe(false);
    // El acuse del receptor de avisos de la demo no es un segundo aviso.
    const ack = row("wake.attempt", { service: "coordination", agentId: "b1", attrs: { ok: true, code: "accepted", httpStatus: 202 } });
    expect(isFlowRow(ack)).toBe(false);
    expect(createTelemetryMapper(directory()).map(ack)).toEqual([]);
    expect(isFlowRow(row("wake.attempt", { attrs: { ok: true } }))).toBe(true);
    // Cada evento que se mapea declara sus atributos.
    for (const name of flowEventNames) expect(flowAttrKeys[name], name).toBeDefined();
  });
});
