// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { Feedback } from "../action-feedback";
import { inviteToCircle } from "../circles/actions";
import { CirclePicker } from "./circle-picker";

vi.mock("../circles/actions", () => ({ inviteToCircle: vi.fn() }));

const invite = vi.mocked(inviteToCircle);
const address = "carla@sideband.app";
const circles = [
  { id: "club", name: "Club" },
  { id: "equipo", name: "Equipo", joined: true },
  { id: "familia", name: "Familia", joined: false },
  { id: "coro", name: "Coro" },
];
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
});

afterEach(async () => {
  await act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  invite.mockReset();
});

it("ofrece solo los círculos disponibles y retira el formulario al agotarse las opciones", async () => {
  await act(() => root.render(<CirclePicker address={address} circles={circles} />));
  const choices = [...host.querySelectorAll("select option")].filter((option) => !option.hasAttribute("disabled"));
  expect(choices.map((option) => option.textContent)).toEqual(["Club", "Coro"]);
  expect(host.textContent).toContain("Equipo · Ya es miembro");
  expect(host.textContent).toContain("Familia · Invitación pendiente");

  const updated = circles.map((circle) => ({ ...circle, joined: circle.joined ?? false }));
  await act(() => root.render(<CirclePicker address={address} circles={updated} />));
  expect(host.querySelector("form")).toBeNull();
  expect(host.textContent).toContain("Coro · Invitación pendiente");
});

it("envía la dirección al círculo elegido, evita un segundo envío pendiente y permite reintentar", async () => {
  const reply = Promise.withResolvers<Feedback>();
  invite.mockReturnValueOnce(reply.promise).mockResolvedValueOnce({});
  await act(() => root.render(<CirclePicker address={address} circles={circles} />));
  const select = host.querySelector("select")!;
  const button = host.querySelector("button")!;
  select.value = "coro";
  await act(() => button.click());
  expect(button.disabled).toBe(true);
  await act(() => button.click());
  expect(invite).toHaveBeenCalledTimes(1);
  const [circleId, , form] = invite.mock.calls[0];
  expect([circleId, form.get("address")]).toEqual(["coro", address]);

  await act(() => reply.resolve({ error: "No se pudo invitar.", errorId: "err-42" }));
  const alert = host.querySelector('[role="alert"]');
  expect(alert?.textContent).toContain("No se pudo invitar.");
  expect(alert?.textContent).toContain("err-42");
  expect(button.disabled).toBe(false);

  select.value = "coro";
  await act(() => button.click());
  expect(invite).toHaveBeenCalledTimes(2);
  expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(host.querySelector('[role="status"]')?.textContent).toBe(`Invitación enviada a ${address} para Coro.`);
});

it("pide elegir un círculo cuando el formulario llega sin selección", async () => {
  await act(() => root.render(<CirclePicker address={address} circles={circles} />));
  const form = host.querySelector("form")!;
  form.noValidate = true;
  await act(() => form.querySelector("button")!.click());
  expect(invite).not.toHaveBeenCalled();
  expect(host.querySelector('[role="alert"]')?.textContent).toBe("Elige un círculo disponible.");
});
