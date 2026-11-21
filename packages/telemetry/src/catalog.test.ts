import { describe, expect, it } from "vitest";
import { catalog, describeCatalog, getEventDefinition } from "./catalog.js";

describe("catálogo", () => {
  it("declara todos los eventos de docs/admin.md#3", () => {
    const expected = [
      "service.started", "service.heartbeat", "service.listening", "service.stopping",
      "http.request", "http.rate_limited",
      "auth.token.verified", "auth.token.rejected", "auth.service_jwt.rejected", "auth.oauth.consent", "auth.scope.denied",
      "message.interpret", "message.interpreted", "message.recipients.resolved", "message.turn.saved", "message.turn.completed",
      "broker.ask.receipt", "broker.ask.relation_checked", "broker.profiles.searched",
      "web.invite.progress", "web.agent.ping",
      "mcp.tool.call", "broker.policy.evaluated", "broker.request.created", "broker.request.status_changed",
      "broker.request.closed", "broker.reply.rejected", "broker.reply.sanitized", "broker.owner.decided", "broker.grant.set", "broker.grant.revoked",
      "broker.contact.connected", "broker.contact.removed", "broker.contact.tagged", "broker.channel.set", "broker.tag.changed",
      "broker.vault.changed", "broker.vault.queried",
      "broker.circle.changed", "broker.agent.connected", "broker.agent.revoked",
      "worker.tick.completed", "wake.attempt", "wake.exhausted", "wake.lease_recovered", "wake.callback_verification", "coordination.tool.call", "demo.contact.seeded", "error",
      "admin.login", "admin.logout", "admin.reveal", "admin.action", "admin.token.created",
      "admin.token.revoked", "admin.mcp.call", "admin.live.opened", "admin.live.closed", "telemetry.invalid_event",
      "whatsapp.link", "whatsapp.request", "whatsapp.send", "whatsapp.delivery", "whatsapp.interpret",
    ];
    expect(catalog.map((event) => event.name).sort()).toEqual(expected.sort());
    expect(new Set(catalog.map((event) => event.name)).size).toBe(catalog.length);
  });

  it("solo acepta escalares y descarta llaves no declaradas", () => {
    const definition = getEventDefinition("mcp.tool.call")!;
    expect(definition.attrs.parse({ tool: "ask", outcome: "ok", authorization: "Bearer x" })).toEqual({ tool: "ask", outcome: "ok" });
    expect(definition.attrs.safeParse({ outcome: "maybe" }).success).toBe(false);
    expect(getEventDefinition("http.request")!.attrs.safeParse({ route: "/v1/x?token=abc def" }).success).toBe(false);
  });

  it("se serializa para admin://schema", () => {
    const entry = describeCatalog().find((event) => event.name === "wake.attempt");
    expect(entry).toMatchObject({ kind: "wake", attrs: ["kind", "attempt", "queueWaitMs", "ok", "httpStatus", "code"] });
    expect(JSON.parse(JSON.stringify(describeCatalog()))).toHaveLength(catalog.length);
  });
});
