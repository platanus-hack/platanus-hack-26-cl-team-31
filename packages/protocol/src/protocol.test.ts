import { describe, expect, it } from "vitest";
import {
  ActivityItem,
  AskInput,
  fieldsOf,
  fixtureSharingRules,
  fixtureUsers,
  GrantInput,
  ReplyInput,
  RequesterView,
  ToolArgs,
  ToolResultSchemas,
  WAKE_EVENT,
  WakeNotice,
  WakeTarget,
} from "./index.js";

const to = fixtureUsers.diego.address;
const availability = {
  date: "2026-11-21",
  start: "10:00",
  durationMinutes: 30,
  timezone: "America/Santiago",
};

describe("AskInput", () => {
  it("accepts a valid availability request", () => {
    expect(AskInput.parse({ to, tool: "availability", args: availability }).args).toEqual(
      availability,
    );
  });

  it("rejects unknown tools", () => {
    expect(AskInput.safeParse({ to, tool: "other", args: {} }).success).toBe(false);
  });

  it.each([14, 481, 15.5])("rejects a duration of %s minutes", (durationMinutes) => {
    expect(
      AskInput.safeParse({
        to,
        tool: "availability",
        args: { ...availability, durationMinutes },
      }).success,
    ).toBe(false);
  });

  it.each([15, 480])("accepts a duration of %s minutes", (durationMinutes) => {
    expect(ToolArgs.availability.safeParse({ ...availability, durationMinutes }).success).toBe(true);
  });

  it("rejects uppercase addresses", () => {
    expect(AskInput.safeParse({ to: "Diego@nexo.app", tool: "profile", args: {} }).success).toBe(
      false,
    );
  });

  it.each([
    { date: "2026-02-30" },
    { start: "24:00" },
    { timezone: "Nexo/Santiago" },
    { timezone: "+01:00" },
  ])("rejects an invalid availability argument %j", (overrides) => {
    expect(ToolArgs.availability.safeParse({ ...availability, ...overrides }).success).toBe(false);
  });
});

describe("tool results", () => {
  it("uses the schema to list result fields", () => {
    expect(fieldsOf("availability")).toEqual(["available", "freeSlots"]);
  });

  it("rejects invalid free slot formats", () => {
    expect(
      ToolResultSchemas.availability.safeParse({ available: true, freeSlots: ["18:30-25:00"] })
        .success,
    ).toBe(false);
  });

  it("requires a result for an answered reply", () => {
    expect(
      ReplyInput.safeParse({ requestId: "request-1", nonce: "nonce-1", outcome: "answered" }).success,
    ).toBe(false);
  });
});

describe("request views", () => {
  const expiresAt = "2026-11-21T13:00:00.000Z";
  const base = { requestId: "request-1", to, tool: "availability", expiresAt };

  it("requires a signature on a final response", () => {
    expect(RequesterView.safeParse({ ...base, final: true, decision: "deny" }).success).toBe(false);
  });

  it("rejects a result from another tool", () => {
    expect(
      RequesterView.safeParse({
        ...base,
        final: true,
        signature: "signed",
        decision: "allow",
        outcome: "answered",
        result: { answer: "Sí" },
      }).success,
    ).toBe(false);
  });

  it("omits private reasons from sent activity, including timeline events", () => {
    const sent = ActivityItem.parse({
      ...base,
      from: fixtureUsers.simon.address,
      direction: "sent",
      status: "denied",
      createdAt: expiresAt,
      internalReason: "Motivo interno",
      decisionReason: "Motivo de decisión",
      events: [{ kind: "permission", at: expiresAt, decisionReason: "Motivo de decisión" }],
    });
    expect(sent).not.toHaveProperty("internalReason");
    expect(sent).not.toHaveProperty("decisionReason");
    expect(sent.events[0]).toEqual({ kind: "permission", at: expiresAt });
  });
});

describe("wake contracts", () => {
  it("rejects a webhook secret without the whsec_ prefix", () => {
    expect(
      WakeTarget.safeParse({
        kind: "standard_webhook",
        url: "https://example.com/webhook",
        secret: "0123456789012345",
      }).success,
    ).toBe(false);
  });

  it("rejects a wake notice that includes request content", () => {
    expect(
      WakeNotice.safeParse({ requestId: "request-1", event: WAKE_EVENT, text: "Contenido" }).success,
    ).toBe(false);
  });
});

it("includes Diego in both fixture circles", () => {
  expect(fixtureSharingRules.circles.amigos).toContain(to);
  expect(fixtureSharingRules.circles.trabajo).toContain(to);
});

describe("GrantInput", () => {
  const grant = { grantee: "ana@nexo.app", tool: "interest_check", fields: ["matches"] };

  it("accepts fields that the tool returns", () => {
    expect(GrantInput.parse(grant)).toEqual(grant);
  });

  it.each([
    ["a field the tool does not return", { ...grant, fields: ["matches", "answer"] }],
    ["no fields", { ...grant, fields: [] }],
    ["the stored profile tool", { ...grant, tool: "profile", fields: ["displayName"] }],
  ])("rejects %s", (_label, input) => {
    expect(GrantInput.safeParse(input).success).toBe(false);
  });
});
