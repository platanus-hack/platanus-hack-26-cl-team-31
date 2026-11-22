// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { changeVault } from "./actions";
import { NewCategory } from "./vault-sheets";

vi.mock("./actions", () => ({ changeVault: vi.fn(async () => ({})) }));

it("creates a category private by default and public when the holder marks it", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  try {
    await act(() => root.render(<NewCategory />));
    await act(() => host.querySelector<HTMLButtonElement>("button")!.click());
    const form = host.querySelector("form")!;
    const name = form.querySelector("input")!;
    const create = async (value: string) => {
      await act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(name, value);
        name.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await act(async () => { form.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true })); });
      return Object.fromEntries(vi.mocked(changeVault).mock.lastCall![0].entries());
    };
    expect(await create("Tallas")).toEqual({ action: "create", name: "Tallas", visibility: "private" });
    await act(() => form.querySelector<HTMLButtonElement>('[role="switch"]')!.click());
    expect(await create("Recetas")).toEqual({ action: "create", name: "Recetas", visibility: "public" });
  } finally {
    await act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
