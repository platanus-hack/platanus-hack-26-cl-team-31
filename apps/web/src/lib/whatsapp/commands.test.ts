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
    vault: vi.fn().mockResolvedValue({ categories: [] }),
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

it("lista las bóvedas propias con su descripción y abre una por nombre sin usar el modelo", async () => {
  const { broker, report } = fixture();
  broker.vault.mockResolvedValue({ categories: [
    { id: "health", name: "Salud", description: "Alergias y tratamientos.", visibility: "private", tags: [], entries: [{ label: "Alergia", value: "Maní" }] },
    { id: "interests", name: "Intereses", visibility: "public", tags: [], entries: [] },
  ] });
  const interpret = vi.fn();
  await expect(runCommand(broker, owner, "bóvedas", report, interpret)).resolves.toBe(
    "Tus bóvedas:\n• Salud: Alergias y tratamientos.\n• Intereses (pública): sin descripción\nEscribe «bóveda» y un nombre para ver lo que guarda.");
  await expect(runCommand(broker, owner, "Boveda salud?", report, interpret)).resolves.toBe("Salud: Alergias y tratamientos.\n• Alergia: Maní");
  await expect(runCommand(broker, owner, "bóveda Intereses", report, interpret)).resolves.toBe("Intereses (pública): sin descripción\nAún no guarda datos.");
  await expect(runCommand(broker, owner, "bóveda Viajes", report, interpret)).resolves.toContain("No tienes una bóveda llamada «Viajes»");
  expect(interpret).not.toHaveBeenCalled();
  expect(broker.ask).not.toHaveBeenCalled();
});

it("escribe la respuesta del flujo sobre las bóvedas propias igual que los comandos", async () => {
  const { broker, report } = fixture();
  const health = { id: "health", name: "Salud", description: "Alergias y tratamientos.", visibility: "private", tags: [] };
  const flow = vi.fn()
    .mockResolvedValueOnce({ kind: "own_vault", data: { categories: [health] } })
    .mockResolvedValueOnce({ kind: "own_vault", data: { categories: [{ ...health, entries: [{ label: "Alergia", value: "Maní" }] }] } })
    .mockResolvedValueOnce({ kind: "own_vault", data: { categories: [] } });
  await expect(runCommand(broker, owner, "dime las bóvedas que tengo", report, flow)).resolves.toBe(
    "Tus bóvedas:\n• Salud: Alergias y tratamientos.\nEscribe «bóveda» y un nombre para ver lo que guarda.");
  await expect(runCommand(broker, owner, "qué guardo en salud", report, flow)).resolves.toBe("Salud: Alergias y tratamientos.\n• Alergia: Maní");
  await expect(runCommand(broker, owner, "qué guardo", report, flow)).resolves.toContain("Tu bóveda no tiene categorías");
  expect(broker.vault).not.toHaveBeenCalled();
});

it("muestra el catálogo de un contacto con su descripción y marca lo que no se puede leer", async () => {
  const { broker, report } = fixture();
  const flow = vi.fn().mockResolvedValue({ kind: "vault", data: { categories: [
    { id: "health", name: "Salud", description: "Alergias y tratamientos.", visibility: "private", canRead: false },
    { id: "interests", name: "Intereses", visibility: "public", canRead: true },
  ] } });
  await expect(runCommand(broker, owner, "qué bóvedas tiene Simón", report, flow)).resolves.toBe(
    "Salud: Alergias y tratamientos. (sin acceso)\nIntereses");
});

it("escribe una lectura de bóveda de varios contactos con quienes no la comparten al final", async () => {
  const { broker, report } = fixture();
  const salud = (entries: { label: string; value: string }[]) => ({ categories: [{ id: "s", name: "Salud", visibility: "private", canRead: true, entries }] });
  const flow = vi.fn()
    .mockResolvedValueOnce({ kind: "vaults", categoryName: "Salud", missing: ["carla@sideband.app"], items: [
      { to: "sofia@sideband.app", data: salud([{ label: "Tipo de sangre", value: "O negativo" }, { label: "Donante", value: "Sí" }]) },
      { to: "tomas@sideband.app", data: salud([]) },
    ] })
    .mockResolvedValueOnce({ kind: "vaults", categoryName: "Salud", missing: ["carla@sideband.app"], items: [] });
  await expect(runCommand(broker, owner, "¿Alguien tiene sangre O negativo?", report, flow)).resolves.toBe([
    "sofia@sideband.app · Salud: Tipo de sangre: O negativo; Donante: Sí",
    "tomas@sideband.app · Salud: aún no guarda datos",
    "No te comparten «Salud»: carla@sideband.app",
  ].join("\n"));
  await expect(runCommand(broker, owner, "¿Alguien tiene sangre O negativo?", report, flow))
    .resolves.toBe("Ninguno de tus contactos te comparte «Salud».");
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
