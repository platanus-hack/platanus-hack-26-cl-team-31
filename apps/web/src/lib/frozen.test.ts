import { expect, it, vi } from "vitest";
import { frozenOwnerClient } from "./frozen";

vi.mock("server-only", () => ({}));

const owner = { userId: "frozen-user" };

it("returns the same destination, tool and expiry when polling a frozen question or invitation", async () => {
  const to = "bruno@sideband.app";
  const [question, invitation] = await Promise.all([
    frozenOwnerClient.ask(owner, { to, tool: "question", args: { text: "¿Jugamos?" } }),
    frozenOwnerClient.connect(owner, { to }),
  ]);
  expect(question).toMatchObject({ to, tool: "question", decision: "pending" });
  expect(invitation).toMatchObject({ to, tool: "connect", decision: "pending" });
  for (const view of [question, invitation]) {
    expect(Date.parse(view.expiresAt)).toBeGreaterThan(Date.now());
    expect(await frozenOwnerClient.status(owner, view.requestId)).toEqual(view);
  }
});

it("returns a tag preview with the requested changes and keeps the frozen source intact", async () => {
  const { tags } = await frozenOwnerClient.contacts(owner);
  const original = tags[0];
  const updated = await frozenOwnerClient.updateTag(owner, original.id, { name: "Prueba", categories: [] });
  expect(updated).toEqual({ ...original, name: "Prueba", categories: [] });
  expect(original.name).not.toBe(updated.name);
});

it("rejects updates to tags absent from the frozen contacts", async () => {
  await expect(frozenOwnerClient.updateTag(owner, "missing", { color: "slate" }))
    .rejects.toMatchObject({ code: "not_found" });
});
