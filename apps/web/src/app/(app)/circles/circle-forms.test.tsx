// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, onTestFinished, vi } from "vitest";

import { inviteToCircle } from "./actions";
import { CircleTile } from "./circle-cards";

vi.mock("./actions", () => ({ inviteToCircle: vi.fn(async () => ({})) }));

it("envía la invitación a la dirección escrita en el círculo que abrió el titular", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const list = document.body.appendChild(document.createElement("ul"));
  const root = createRoot(list);
  onTestFinished(async () => {
    await act(() => root.unmount());
    list.remove();
    vi.unstubAllGlobals();
  });

  const owner = "ana@sideband.app";
  const circles = [{ id: "c1", name: "Fútbol" }, { id: "c2", name: "Lectura" }];
  await act(() => root.render(circles.map((circle) =>
    <CircleTile key={circle.id} address={owner} circle={{ ...circle, owner, members: [{ address: owner, joined: true }] }} />,
  )));
  await act(() => list.querySelector<HTMLButtonElement>('[aria-label="Abrir Lectura"]')!.click());
  const form = list.querySelector("dialog[open] form")!;
  form.querySelector("input")!.value = "bob@sideband.app";
  await act(async () => { form.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true })); });

  const invitations = vi.mocked(inviteToCircle).mock.calls.map(([id, , data]) => [id, data.get("address")]);
  expect(invitations).toEqual([["c2", "bob@sideband.app"]]);
});
