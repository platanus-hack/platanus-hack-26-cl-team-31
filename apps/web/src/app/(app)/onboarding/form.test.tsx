// @vitest-environment happy-dom
import { ADDRESS_DOMAIN } from "@team-31/protocol/constants";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import { AddressForm } from "./form";

vi.mock("./actions", () => ({ claimAddress: vi.fn() }));

it("actualiza la vista previa con la dirección que escribe el titular", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  try {
    await act(() => root.render(<AddressForm source={undefined} />));
    const input = host.querySelector("input")!;
    await act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "ana.soto");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(host.querySelector("#address-preview")?.textContent).toContain(`ana.soto@${ADDRESS_DOMAIN}`);
  } finally {
    await act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
