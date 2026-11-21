import { expect, it, vi } from "vitest";
import { runCommand } from "./commands";

const owner = { userId: "holder" };
const requestId = "e9ca0fa6-fd8b-426b-9db6-9be9005126e6";
const to = "simon@sideband.app";
const pending = { requestId, to, tool: "question", final: false, decision: "pending", waitingFor: "agent" };

function fixture(addresses = [to]) {
  const broker = {
    ask: vi.fn().mockResolvedValue(pending),
    activity: vi.fn().mockResolvedValue([]),
    status: vi.fn().mockResolvedValue(pending),
    contacts: vi.fn().mockResolvedValue({ contacts: addresses.map((address) => ({ address })) }),
  };
  return { broker, report: vi.fn() };
}

it("envía la pregunta original con una dirección explícita, aunque no use un comando", async () => {
  const { broker, report } = fixture();
  const text = "simon@sideband.app puede ir a tomar café en una hora?";
  await runCommand(broker, owner, text, report, async () => ({ action: "ask", recipient: to }));
  expect(broker.ask).toHaveBeenCalledExactlyOnceWith(owner, { to, tool: "question", args: { text } });
  expect(broker.contacts).not.toHaveBeenCalled();
});

it("no consulta al broker si hay dos coincidencias o Claude devuelve una dirección que no se escribió", async () => {
  const { broker, report } = fixture([to, "simon.otro@sideband.app"]);
  const text = "¿Simón apaña a un café?";
  await expect(runCommand(broker, owner, text, report, async () => ({ action: "ask", recipient: "Simón" })))
    .resolves.toContain("No pude identificar");
  await expect(runCommand(broker, owner, text, report, async () => ({ action: "ask", recipient: to })))
    .resolves.toContain("No pude identificar");
  expect(broker.ask).not.toHaveBeenCalled();
});

it("un seguimiento solo lee solicitudes enviadas y no manda otra pregunta", async () => {
  const { broker, report } = fixture();
  broker.activity.mockResolvedValue([
    { direction: "received", to, requestId: "incoming" },
    { direction: "sent", to: "ana@sideband.app", requestId: "other-contact" },
    { direction: "sent", to, requestId },
  ]);
  await runCommand(broker, owner, "¿Y qué dijo Simón?", report, async () => ({ action: "status", recipient: "Simón" }));
  expect(broker.status).toHaveBeenCalledExactlyOnceWith(owner, requestId);
  expect(broker.ask).not.toHaveBeenCalled();
});

it("mantiene los comandos explícitos sin llamar a Claude", async () => {
  const { broker, report } = fixture();
  const interpret = vi.fn();
  await runCommand(broker, owner, `Pregunta a ${to} si puede ir a tomar café`, report, interpret);
  await runCommand(broker, owner, `estado ${requestId}`, report, interpret);
  expect(interpret).not.toHaveBeenCalled();
  expect(broker.ask).toHaveBeenCalledOnce();
  expect(broker.status).toHaveBeenCalledOnce();
});
