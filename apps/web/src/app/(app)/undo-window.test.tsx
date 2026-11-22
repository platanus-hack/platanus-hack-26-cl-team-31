// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { removeFromCircle } from "./circles/actions";
import { CircleTile } from "./circles/circle-cards";
import { answerInvitation, deleteTag } from "./contacts/actions";
import { IncomingInvitation } from "./contacts/contact-forms";
import { TagRow } from "./tags/tag-sheets";
import { changeVault } from "./vault/actions";
import { CategoryRow } from "./vault/vault-sheets";

vi.mock("./circles/actions", () => ({ removeFromCircle: vi.fn() }));
vi.mock("./contacts/actions", () => ({ answerInvitation: vi.fn(), deleteTag: vi.fn() }));
vi.mock("./vault/actions", () => ({ changeVault: vi.fn() }));

const categoryId = "df73729a-12ca-4486-8f36-783c6af6e466";
const owner = "ana@sideband.app";
const member = "bob@sideband.app";
const circle = {
  id: "club", name: "Club", owner,
  members: [{ address: owner, joined: true }, { address: member, joined: true }],
};
const cases = [
  {
    name: "salir de un círculo", open: "Abrir Club", action: "Salir del círculo",
    row: <CircleTile circle={circle} address={member} />,
    mutation: vi.mocked(removeFromCircle),
    requests: () => vi.mocked(removeFromCircle).mock.calls,
    expected: [circle.id, member], success: {},
  },
  {
    name: "eliminar una categoría", open: "Abrir Recetas", action: "Eliminar categoría",
    row: <CategoryRow category={{ id: categoryId, name: "Recetas", entries: [], tags: [], visibility: "private" }} tags={[]} />,
    mutation: vi.mocked(changeVault),
    requests: () => vi.mocked(changeVault).mock.calls.map(([form]) => Object.fromEntries(form)),
    expected: { action: "delete", categoryId }, success: { message: "Guardado." },
  },
  {
    name: "eliminar una etiqueta", open: "Editar Amigo", action: "Eliminar etiqueta",
    row: <TagRow tag={{ id: "friend", name: "Amigo", color: "emerald", categories: [], members: [] }} />,
    mutation: vi.mocked(deleteTag),
    requests: () => vi.mocked(deleteTag).mock.calls.map(([id]) => id),
    expected: "friend", success: {},
  },
  {
    name: "rechazar una invitación", action: "Rechazar",
    row: <IncomingInvitation invitation={{ requestId: "invite", address: "ana@sideband.app", offer: [], expiresAt: "2026-12-01T00:00:00Z" }} tags={[]} />,
    mutation: vi.mocked(answerInvitation),
    requests: () => vi.mocked(answerInvitation).mock.calls.map(([id, , form]) => [id, form.get("answer")]),
    expected: ["invite", "decline"], success: { message: "Invitación rechazada." },
  },
];

let host: HTMLUListElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.body.appendChild(document.createElement("ul"));
  root = createRoot(host);
});

afterEach(async () => {
  await act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

async function click(label: string) {
  const button = Array.from(host.querySelectorAll("button")).find((element) =>
    (element.getAttribute("aria-label") ?? element.textContent) === label);
  expect(button, label).toBeDefined();
  await act(() => button!.click());
}

async function advance(ms: number) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

it.each(cases)("al $name, un fallo requiere un nuevo clic y otro plazo completo", async (testCase) => {
  const { row, open, action, mutation, requests, expected } = testCase;
  mutation.mockResolvedValueOnce({ error: "Intenta de nuevo.", errorId: "err-test" });
  const retry = Promise.withResolvers<typeof testCase.success>();
  mutation.mockReturnValueOnce(retry.promise);
  await act(() => root.render(row));
  async function schedule() {
    if (open) await click(open);
    await click(action);
  }

  await schedule();
  await advance(5000);
  expect(requests()).toEqual([expected]);
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("err-test");
  await advance(15_000);
  expect(requests()).toEqual([expected]);

  await schedule();
  await advance(4999);
  await click("Deshacer");
  await advance(5000);
  expect(requests()).toEqual([expected]);

  await schedule();
  await advance(4999);
  expect(requests()).toEqual([expected]);
  await advance(1);
  expect(requests()).toEqual([expected, expected]);
  expect(host.textContent).not.toContain("Deshacer");
  await act(() => retry.resolve(testCase.success));
  await advance(15_000);
  expect(requests()).toEqual([expected, expected]);
  expect(host.textContent).not.toContain("Deshacer");
  expect(host.querySelector('[role="alert"]')).toBeNull();
});
