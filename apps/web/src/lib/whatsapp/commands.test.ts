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
  await runCommand(broker, owner, text, report, async () => ({ action: "ask", recipient: to, category: "availability" }));
  expect(broker.ask).toHaveBeenCalledExactlyOnceWith(owner, { to, tool: "question", args: { text, category: "availability" } }, "whatsapp");
  expect(broker.contacts).not.toHaveBeenCalled();
});

it("no consulta al broker si hay dos coincidencias o Claude devuelve una dirección que no se escribió", async () => {
  const { broker, report } = fixture([to, "simon.otro@sideband.app"]);
  const text = "¿Simón apaña a un café?";
  await expect(runCommand(broker, owner, text, report, async () => ({ action: "ask", recipient: "Simón", category: "availability" })))
    .resolves.toContain("No pude identificar");
  await expect(runCommand(broker, owner, text, report, async () => ({ action: "ask", recipient: to, category: "availability" })))
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
  await runCommand(broker, owner, "¿Y qué dijo Simón?", report, async () => ({ action: "status", recipient: "Simón", category: null }));
  expect(broker.status).toHaveBeenCalledExactlyOnceWith(owner, requestId);
  expect(broker.ask).not.toHaveBeenCalled();
});

it("mantiene las preguntas explícitas sin Claude y los comandos de estado no usan el modelo", async () => {
  const { broker, report } = fixture();
  const interpret = vi.fn();
  await runCommand(broker, owner, `Pregunta a ${to} si puede ir a tomar café`, report);
  await runCommand(broker, owner, `estado ${requestId}`, report, interpret);
  expect(interpret).not.toHaveBeenCalled();
  expect(broker.ask).toHaveBeenCalledExactlyOnceWith(owner, {
    to, tool: "question", args: { text: "si puede ir a tomar café", category: "general" },
  }, "whatsapp");
  expect(broker.status).toHaveBeenCalledOnce();
});

it("clasifica preguntas explícitas sin dejar que el modelo cambie la dirección ni reintentar si se deniega", async () => {
  const { broker, report } = fixture();
  const text = "si puede juntarse hoy";
  broker.ask.mockResolvedValue({ ...pending, decision: "deny", final: true });
  broker.contacts.mockResolvedValue({ contacts: [{ address: to, gives: [], receives: ["availability"] }] });
  const result = await runCommand(broker, owner, `Pregunta a ${to} ${text}`, report,
    async () => ({ action: "ask", recipient: "otro@sideband.app", category: "availability" }));
  expect(broker.ask).toHaveBeenCalledExactlyOnceWith(owner, { to, tool: "question", args: { text, category: "availability" } }, "whatsapp");
  expect(result).toBe(`No se pudo obtener una respuesta de ${to}.`);
});

it("pide reformular una pregunta con varias categorías sin enviar nada", async () => {
  const { broker, report } = fixture();
  const result = await runCommand(broker, owner, `¿${to} está libre hoy y le gusta el café?`, report,
    async () => ({ action: "ask", recipient: to, category: null }));
  expect(result).toContain("Reformula");
  expect(broker.ask).not.toHaveBeenCalled();
});

it("lista los contactos con lo que cada uno comparte, con o sin Claude", async () => {
  const { broker, report } = fixture();
  broker.contacts.mockResolvedValue({ contacts: [
    { address: to, gives: ["general"], receives: ["availability", "interests"] },
    { address: "ana@sideband.app", gives: [], receives: [] },
  ] });
  const interpret = vi.fn().mockResolvedValue({ action: "contacts", recipient: null, category: null });
  const reply = await runCommand(broker, owner, "dime qué amigos tengo", report, interpret);
  expect(reply).toContain(`• ${to}: te comparte Disponibilidad horaria · Intereses`);
  expect(reply).toContain("• ana@sideband.app: te comparte Nada");
  await expect(runCommand(broker, owner, "contactos", report)).resolves.toBe(reply);
  expect(interpret).toHaveBeenCalledOnce();
  expect(broker.ask).not.toHaveBeenCalled();
  expect(report).not.toHaveBeenCalled();
});

it("avisa cuando todavía no hay contactos", async () => {
  const { broker, report } = fixture([]);
  await expect(runCommand(broker, owner, "contactos", report)).resolves.toContain("Aún no tienes contactos");
});

it("explica una denegación con lo que el contacto no comparte, según la agenda del titular", async () => {
  const { broker, report } = fixture();
  broker.ask.mockResolvedValue({ ...pending, decision: "deny", final: true });
  broker.contacts.mockResolvedValue({ contacts: [{ address: to, gives: [], receives: ["availability", "interests"] }] });
  const health = async () => ({ action: "ask" as const, recipient: to, category: "health" as const });
  await expect(runCommand(broker, owner, `${to} tiene sangre O negativo?`, report, health))
    .resolves.toBe(`${to} no te comparte su información de salud.`);
  broker.contacts.mockResolvedValue({ contacts: [] });
  await expect(runCommand(broker, owner, `${to} tiene sangre O negativo?`, report, health))
    .resolves.toBe(`${to} no está entre tus contactos.`);
});
