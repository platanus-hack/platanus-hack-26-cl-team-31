// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { categories } from "@team-31/protocol/constants";
import { ContactRow } from "./contact-forms";
import { saveContactTags, saveSharing } from "./actions";

vi.mock("./actions", () => ({
  saveSharing: vi.fn(async () => ({})), removeContact: vi.fn(), saveContactTags: vi.fn(), createTag: vi.fn(), saveTag: vi.fn(), deleteTag: vi.fn(),
}));

const address = "ana@sideband.app";
let list: HTMLUListElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  list = document.body.appendChild(document.createElement("ul"));
  root = createRoot(list);
});

afterEach(async () => {
  await act(() => root.unmount());
  list.remove();
  vi.unstubAllGlobals();
});

it("submits exactly the categories selected in the contact form", async () => {
  await act(() => root.render(<ContactRow contact={{ address, tags: ["friend"], gives: ["availability"], receives: [] }}
    tags={[{ id: "friend", name: "Amigo", color: "emerald", categories: [] }]} />));
  await act(() => list.querySelector<HTMLButtonElement>('[aria-label="Ver opciones"]')!.click());
  const form = list.querySelector("form")!;
  const toggle = async (label: string) => {
    const button = [...form.querySelectorAll<HTMLButtonElement>('[role="switch"]')].find((control) =>
      document.getElementById(control.getAttribute("aria-labelledby")!)?.textContent === label);
    expect(button).toBeDefined();
    await act(() => button!.click());
  };
  const submit = async (selected: string[]) => {
    await act(async () => { form.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true })); });
    const call = vi.mocked(saveSharing).mock.lastCall!;
    expect(call[0]).toBe(address);
    expect([...call[2].entries()]).toEqual(selected.map((value) => ["category", value]));
  };
  await toggle(categories.health.label);
  await submit(["availability", "health"]);
  await toggle(categories.availability.label);
  await toggle(categories.health.label);
  await submit([]);
});

it("espera a que termine el guardado de etiquetas antes de aceptar otro cambio", async () => {
  const save = vi.mocked(saveContactTags);
  const pending = Promise.withResolvers<Awaited<ReturnType<typeof saveContactTags>>>();
  save.mockReturnValueOnce(pending.promise).mockResolvedValue({});
  const render = (selected: string[]) => act(() => root.render(
    <ContactRow contact={{ address, tags: selected, gives: [], receives: [] }} tags={[
      { id: "friend", name: "Amigo", color: "emerald", categories: [] },
      { id: "work", name: "Trabajo", color: "violet", categories: [] },
    ]} />,
  ));
  await render([]);
  await act(() => list.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')!.click());
  const [friend, work] = list.querySelectorAll<HTMLButtonElement>('[role="menuitemcheckbox"]');
  await act(() => friend!.click());
  await act(() => work!.click());
  expect(save.mock.calls).toEqual([[address, ["friend"]]]);

  await act(() => pending.resolve({}));
  await render(["friend"]);
  await act(() => work!.click());
  expect(save.mock.calls).toEqual([[address, ["friend"]], [address, ["friend", "work"]]]);
});
