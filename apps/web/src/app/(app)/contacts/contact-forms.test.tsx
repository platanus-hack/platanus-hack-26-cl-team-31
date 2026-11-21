// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { categories } from "@team-31/protocol/constants";
import { ContactRow } from "./contact-forms";
import { saveSharing } from "./actions";

vi.mock("./actions", () => ({
  saveSharing: vi.fn(async () => ({})), removeContact: vi.fn(),
}));

it("submits exactly the categories selected in the contact form", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const list = document.body.appendChild(document.createElement("ul"));
  const root = createRoot(list);
  const address = "ana@sideband.app";
  try {
    await act(() => root.render(<ContactRow contact={{ address, gives: ["availability"], receives: [] }}
      presets={{ friend: [], work: [], family: [] }} />));
    await act(() => list.querySelector<HTMLButtonElement>("[aria-expanded]")!.click());
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
  } finally {
    await act(() => root.unmount());
    list.remove();
    vi.unstubAllGlobals();
  }
});
