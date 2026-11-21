import { expect, it, vi } from "vitest";
import { runCommand } from "./commands";

const { recordError } = vi.hoisted(() => ({ recordError: vi.fn() }));
vi.mock("../telemetry", () => ({ getTelemetry: () => ({ error: recordError }) }));

const owner = { userId: "holder" };
const requestId = "e9ca0fa6-fd8b-426b-9db6-9be9005126e6";
const to = "simon@sideband.app";
const pending = { requestId, to, tool: "question", final: false, decision: "pending", waitingFor: "agent" };

function fixture(addresses = [to]) {
  const broker = {
    answerInvitation: vi.fn(),
    ask: vi.fn().mockResolvedValue(pending),
    activity: vi.fn().mockResolvedValue([]),
    status: vi.fn().mockResolvedValue(pending),
    contacts: vi.fn().mockResolvedValue({ contacts: addresses.map((address) => ({ address })) }),
  };
  return { broker, report: vi.fn() };
}

it("acepta solo una invitación recibida y comparte solo lo que indicó el titular", async () => {
  const { broker, report } = fixture();
  broker.contacts.mockResolvedValue({ incoming: [{ address: to, requestId }], outgoing: [] });
  await expect(runCommand(broker, owner, "acepta a Simón", report)).resolves.toContain("¿Qué quieres compartir?");
  expect(broker.answerInvitation).not.toHaveBeenCalled();
  await runCommand(broker, owner, "acepta a Simón y compártele solo disponibilidad", report);
  expect(broker.answerInvitation).toHaveBeenCalledExactlyOnceWith(owner, requestId, { accept: true, share: ["availability"] });
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

it("envía la pregunta de estado informal al flujo si está configurado y consulta la última enviada en su ausencia", async () => {
  const { broker, report } = fixture();
  const text = "¿Ya respondió?";
  const flow = vi.fn().mockResolvedValue({ kind: "unavailable", reason: "expired" });
  await expect(runCommand(broker, owner, text, report, flow)).resolves.toContain("Ese turno venció");
  expect(flow).toHaveBeenCalledExactlyOnceWith(text);
  expect(broker.activity).not.toHaveBeenCalled();

  broker.activity.mockResolvedValue([
    { direction: "received", requestId: "incoming" },
    { direction: "sent", requestId },
  ]);
  await runCommand(broker, owner, text, report);
  expect(broker.status).toHaveBeenCalledExactlyOnceWith(owner, requestId);
  expect(report).toHaveBeenCalledExactlyOnceWith("status", pending);
});

it("distingue una dirección inválida de una pregunta demasiado larga al usar /pregunta", async () => {
  const { broker, report } = fixture();
  const help = await runCommand(broker, owner, "", report);
  await expect(runCommand(broker, owner, "/pregunta nadie: qué tal", report)).resolves.toBe(help);
  await expect(runCommand(broker, owner, `/pregunta ${to}: ${"a".repeat(1001)}`, report))
    .resolves.toBe(`Incluye una dirección Sideband y una pregunta de hasta 1000 caracteres. ${help}`);
  expect(broker.ask).not.toHaveBeenCalled();
  expect(report).not.toHaveBeenCalled();
});

it("lista los contactos con lo que cada uno comparte, con o sin Claude", async () => {
  const { broker, report } = fixture();
  broker.contacts.mockResolvedValue({ contacts: [
    { address: to, gives: ["general"], receives: ["availability", "interests"] },
    { address: "ana@sideband.app", gives: [], receives: [] },
  ] });
  const interpret = vi.fn().mockResolvedValue({ kind: "contacts", data: { contacts: [
    { address: to, theyShare: ["availability", "interests"] }, { address: "ana@sideband.app", theyShare: [] },
  ], circles: [] } });
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
  await expect(runCommand(broker, owner, `Pregunta a ${to} qué quiere contar`, report))
    .resolves.toBe(`${to} no te comparte respuestas a preguntas abiertas.`);
  broker.contacts.mockResolvedValue({ contacts: [] });
  await expect(runCommand(broker, owner, `Pregunta a ${to} qué quiere contar`, report))
    .resolves.toBe(`${to} no está entre tus contactos.`);
});

it("muestra las opciones de una aclaración sin entregar el identificador opaco al teléfono", async () => {
  const { broker, report } = fixture();
  const flow = vi.fn().mockResolvedValue({ kind: "clarification", question: "¿Cuál Ana?", continuationId: "private",
    choices: [{ label: "Ana P.", value: "ref1" }, { label: "Ana V.", value: "ref2" }] });
  const text = "¿Le gusta el café a mi amiga Ana?";
  await expect(runCommand(broker, owner, text, report, flow)).resolves.toBe("¿Cuál Ana?\n1. Ana P.\n2. Ana V.");
  expect(flow).toHaveBeenCalledExactlyOnceWith(text);
  expect(broker.ask).not.toHaveBeenCalled();
});

it("returns the completed denial when its optional contact lookup fails", async () => {
  const { broker, report } = fixture();
  broker.ask.mockResolvedValue({ requestId, to, decision: "deny", final: true });
  const error = new Error("unavailable");
  broker.contacts.mockRejectedValue(error);
  expect(await runCommand(broker, owner, `Pregunta a ${to} si viene`, report)).toBe(`No se pudo obtener una respuesta de ${to}.`);
  expect(recordError).toHaveBeenCalledWith("whatsapp.denial.contacts", error, { requestId, userId: owner.userId });
  expect(broker.ask).toHaveBeenCalledOnce();
});
