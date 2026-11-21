import { describe, expect, it } from "vitest";
import { commands } from "./demo";
import { describeResult, parseDemoMessage } from "./demo-chat";

const id = "b62f8291-18fd-4899-a266-3a3a78cd9cb5";

describe("chat de demo", () => {
  it("maps a supported availability question to the corresponding Santiago slot", () => {
    expect(parseDemoMessage("eva", "¿Está Bob DISPONIBLE a las 18:00?", null, null)).toEqual({
      tool: "availability_check",
      input: { recipient: "bob", group: "futbol", slot: "2026-11-28T21:00:00.000Z", minutes: 60 },
    });
    expect(parseDemoMessage("ana", "¿Bob está libre a las 18:30?", null, null)).not.toHaveProperty("tool");
  });

  it("does not turn arbitrary input into a tool or reinterpret a reply without an active meeting", () => {
    expect(parseDemoMessage("ana", "group_leave", id, id)).not.toHaveProperty("tool");
    expect(parseDemoMessage("bob", commands.accept, null, id)).not.toHaveProperty("tool");
    expect(parseDemoMessage("bob", commands.accept, id, null)).toEqual({
      tool: "meeting_decide", input: { id, accept: true },
    });
  });

  it("describes a denied answer without treating it as busy", () => {
    expect(describeResult({ tool: "availability_check", input: {} }, { status: "not_shareable" }))
      .toMatch(/^No compartible/);
  });
});
