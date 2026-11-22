// @vitest-environment happy-dom
import type { OwnerPendingItem } from "@team-31/protocol";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { decide, readHome } from "../actions";
import HomePage from "../page";
import { FocusRequest, RequestRow } from "./request-row";

vi.mock("../actions", () => ({ decide: vi.fn(), readHome: vi.fn() }));
vi.mock("@/lib/auth-owner", () => ({ getOwnerAccount: async () => ({ displayName: "Ana" }) }));
vi.mock("@/lib/browser-feedback", () => ({ reportBrowserFailure: vi.fn() }));

const interest = {
  from: "bob@sideband.app", requestId: "interes", tool: "interest_check", args: { interest: "cerámica" },
  senderMessage: { text: "", trusted: false }, expiresAt: "2026-11-21T18:00:00Z", escalated: true,
} satisfies OwnerPendingItem;

const vault = {
  ...interest, requestId: "boveda", tool: "vault_access", args: { categoryName: "Salud" }, escalated: false,
} satisfies OwnerPendingItem;

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  vi.mocked(decide).mockResolvedValue({ message: "Decisión guardada." });
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
});

afterEach(async () => {
  await act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});

function button(label: string, within: ParentNode = host) {
  const control = Array.from(within.querySelectorAll("button")).find((node) => node.textContent === label);
  expect(control, label).toBeDefined();
  return control!;
}

async function advance(ms: number) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

function decisions() {
  return vi.mocked(decide).mock.calls.map(([id, , data]) => [id, data.get("decision")]);
}

it.each([
  { escalated: false, label: "Aprobar", decision: "approve_once" },
  { escalated: true, label: "Me interesa", decision: "yes" },
])("envía $decision cuando el titular elige «$label»", async ({ escalated, label, decision }) => {
  await act(() => root.render(<FocusRequest item={{ ...interest, escalated }} expires="en una hora" />));
  await act(async () => button(label).click());
  expect(decisions()).toEqual([["interes", decision]]);
});

it("deshace el rechazo y concede acceso a la categoría de la bóveda solo al confirmarlo", async () => {
  await act(() => root.render(<FocusRequest item={vault} expires="en una hora" />));
  await act(() => button("Rechazar").click());
  await advance(4999);
  expect(decide).not.toHaveBeenCalled();
  await act(() => button("Deshacer").click());
  await advance(5000);
  expect(decide).not.toHaveBeenCalled();
  await act(async () => button("Conceder").click());
  expect(decisions()).toEqual([["boveda", "grant_vault_read"]]);
});

it("envía la respuesta negativa al vencer el plazo y permite reintentar si falla", async () => {
  vi.mocked(decide).mockResolvedValueOnce({ error: "Intenta de nuevo." });
  await act(() => root.render(<ul><RequestRow item={interest} expires="en una hora" /></ul>));
  await act(() => button("No").click());
  await advance(4999);
  expect(decide).not.toHaveBeenCalled();
  await advance(1);
  expect(decisions()).toEqual([["interes", "no"]]);
  expect(host.querySelector('[role="alert"]')?.textContent).toBe("Intenta de nuevo.");

  await act(() => button("No").click());
  await advance(5000);
  expect(decisions()).toEqual([["interes", "no"], ["interes", "no"]]);
});

it("descarta el rechazo pendiente si cambia la solicitud destacada en el inicio", async () => {
  vi.stubEnv("BETTER_AUTH_URL", "https://web.example.org");
  const refresh = async (pending: Awaited<ReturnType<typeof readHome>>["pending"]) => {
    vi.mocked(readHome).mockResolvedValueOnce({
      pending, activity: [], answered: 0, invitations: [], contacts: 0, agents: 0, now: Date.parse(interest.expiresAt),
    });
    const home = await HomePage();
    await act(() => root.render(home));
  };
  await refresh([interest, vault]);
  await act(() => button("No").click());
  await refresh([vault]);
  await advance(5000);
  expect(decide).not.toHaveBeenCalled();
  await act(async () => button("Conceder").click());
  expect(decisions()).toEqual([["boveda", "grant_vault_read"]]);
});

it("habilita la respuesta escrita al ingresar texto y la envía con el id de la pregunta", async () => {
  const question: OwnerPendingItem = {
    ...interest, requestId: "pregunta", tool: "question", args: { text: "¿Qué te gustaría aprender?", category: "interests" },
  };
  await act(() => root.render(<ul><RequestRow item={question} expires="en una hora" /></ul>));
  await act(() => button("Responder").click());
  const dialog = host.querySelector("dialog")!;
  expect(dialog.textContent).toContain(question.args.text);
  const answer = dialog.querySelector("textarea")!;
  const send = button("Responder", dialog);
  const write = async (text: string) => {
    // Simula una edición del usuario para que React reciba el evento de cambio.
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(answer, text);
    await act(() => { answer.dispatchEvent(new Event("input", { bubbles: true })); });
  };
  await write("   ");
  expect(send.disabled).toBe(true);
  await write("Alfarería");
  expect(send.disabled).toBe(false);
  await act(async () => send.click());
  expect(decisions()).toEqual([["pregunta", "answer"]]);
  expect(vi.mocked(decide).mock.lastCall![2].get("answer")).toBe("Alfarería");
});
