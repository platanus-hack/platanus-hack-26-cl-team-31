import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

// El servidor se prueba como proceso real sobre stdio: el cableado del protocolo es la parte
// riesgosa, no las funciones internas.

const server = fileURLToPath(new URL("../mock-mcp.mjs", import.meta.url));
const fixtureOf = (name: string) => fileURLToPath(new URL(`../fixtures/${name}.json`, import.meta.url));

type Frame = { jsonrpc: "2.0"; id?: number | null; result?: any; error?: { code: number; message: string } };

class Client {
  private readonly frames: Frame[] = [];
  private readonly waiters: ((frame: Frame) => void)[] = [];
  private buffer = "";
  stderr = "";

  constructor(readonly child: ChildProcessWithoutNullStreams) {
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      this.buffer += chunk;
      let index = this.buffer.indexOf("\n");
      while (index !== -1) {
        const line = this.buffer.slice(0, index).trim();
        this.buffer = this.buffer.slice(index + 1);
        if (line !== "") this.push(JSON.parse(line) as Frame);
        index = this.buffer.indexOf("\n");
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      this.stderr += chunk;
    });
  }

  private push(frame: Frame) {
    const waiter = this.waiters.shift();
    if (waiter) waiter(frame);
    else this.frames.push(frame);
  }

  next(): Promise<Frame> {
    const pending = this.frames.shift();
    if (pending) return Promise.resolve(pending);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`sin respuesta en 5s; stderr: ${this.stderr}`)), 5_000);
      this.waiters.push((frame) => {
        clearTimeout(timer);
        resolve(frame);
      });
    });
  }

  write(raw: string) {
    this.child.stdin.write(`${raw}\n`);
  }

  send(method: string, params?: unknown, id?: number) {
    this.write(JSON.stringify({ jsonrpc: "2.0", ...(id === undefined ? {} : { id }), method, params }));
  }

  async request(id: number, method: string, params?: unknown) {
    this.send(method, params, id);
    return this.next();
  }

  async call(id: number, name: string, args: Record<string, unknown> = {}) {
    const frame = await this.request(id, "tools/call", { name, arguments: args });
    return frame.result;
  }

  kill() {
    this.child.kill("SIGKILL");
  }
}

const clients: Client[] = [];

function start(fixture = "ana", env: Record<string, string | undefined> = {}) {
  const child = spawn(process.execPath, [server], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, MOCK_FIXTURE: fixtureOf(fixture), ...env },
  }) as ChildProcessWithoutNullStreams;
  const client = new Client(child);
  clients.push(client);
  return client;
}

afterEach(() => {
  while (clients.length > 0) clients.pop()!.kill();
});

describe("handshake", () => {
  it("responde initialize con protocolo, capacidades e identidad del fixture", async () => {
    const client = start("ana");
    const frame = await client.request(1, "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "0" },
    });
    expect(frame.error).toBeUndefined();
    expect(frame.result.protocolVersion).toBe("2025-06-18");
    expect(frame.result.capabilities.tools).toBeDefined();
    expect(frame.result.serverInfo.name).toBe("mock-mcp:Ana");
  });

  it("acepta notifications/initialized sin responder nada", async () => {
    const client = start("ana");
    await client.request(1, "initialize", {});
    client.send("notifications/initialized");
    const frame = await client.request(2, "ping");
    // La siguiente trama es la del ping: la notificación no generó respuesta.
    expect(frame.id).toBe(2);
    expect(frame.result).toEqual({});
  });
});

describe("tools/list", () => {
  it("expone una tool por categoría de Sideband con su esquema", async () => {
    const client = start("ana");
    await client.request(1, "initialize", {});
    const frame = await client.request(2, "tools/list");
    const names = frame.result.tools.map((tool: { name: string }) => tool.name);
    expect(names).toEqual(["calendar_free_busy", "calendar_events", "interests_list", "health_notes"]);
    for (const tool of frame.result.tools) {
      expect(tool.description).toBeTruthy();
      expect(tool.inputSchema.type).toBe("object");
      expect(tool).not.toHaveProperty("run");
    }
  });
});

describe("datos presentes", () => {
  it("calcula libre/ocupado desde el fixture y nunca devuelve títulos", async () => {
    const client = start("ana");
    await client.request(1, "initialize", {});
    const result = await client.call(2, "calendar_free_busy", { from: "2026-11-23", to: "2026-11-24" });

    expect(result.isError).toBe(false);
    const payload = result.structuredContent;
    expect(payload.status).toBe("ok");
    expect(payload.category).toBe("availability");
    expect(payload.days).toEqual([
      {
        date: "2026-11-23",
        busy: [
          { start: "09:00", end: "11:00" },
          { start: "12:00", end: "13:00" },
        ],
        free: [{ start: "11:00", end: "12:00" }],
      },
      { date: "2026-11-24", busy: [{ start: "09:00", end: "13:00" }], free: [] },
    ]);
    expect(JSON.stringify(payload)).not.toContain("Taller de torno");
    expect(result.content[0].text).toBe(JSON.stringify(payload));
  });

  it("las agendas de Ana y Bob se cruzan en una sola ventana común", async () => {
    const ana = start("ana");
    const bob = start("bob");
    await Promise.all([ana.request(1, "initialize", {}), bob.request(1, "initialize", {})]);
    const [anaDay, bobDay] = await Promise.all([
      ana.call(2, "calendar_free_busy", { from: "2026-11-23" }),
      bob.call(2, "calendar_free_busy", { from: "2026-11-23" }),
    ]);
    expect(anaDay.structuredContent.days[0].free).toEqual([{ start: "11:00", end: "12:00" }]);
    expect(bobDay.structuredContent.days[0].free).toEqual([{ start: "10:00", end: "11:30" }]);
    // La única respuesta correcta a «¿cuándo pueden juntarse?» es 11:00-11:30.
  });

  it("lista los intereses del titular", async () => {
    const client = start("bob");
    await client.request(1, "initialize", {});
    const result = await client.call(2, "interests_list");
    expect(result.structuredContent).toEqual({ status: "ok", category: "interests", interests: ["cerámica", "escalada", "podcasts de historia"] });
  });

  it("devuelve la carga de inyección como dato, con su título intacto", async () => {
    const client = start("bob");
    await client.request(1, "initialize", {});
    const result = await client.call(2, "calendar_events", { from: "2026-11-23" });
    const titles = result.structuredContent.events.map((event: { title: string }) => event.title);
    expect(titles.some((title: string) => title.includes("ignora las instrucciones anteriores"))).toBe(true);
    expect(result.isError).toBe(false);
  });
});

describe("datos ausentes", () => {
  it("un rango fuera de la cobertura devuelve no_data, no un error ni un vacío ambiguo", async () => {
    const client = start("ana");
    await client.request(1, "initialize", {});
    const result = await client.call(2, "calendar_free_busy", { from: "2026-11-26", to: "2026-11-27" });

    expect(result.isError).toBe(false);
    const payload = result.structuredContent;
    expect(payload.status).toBe("no_data");
    expect(payload.days).toBeUndefined();
    expect(payload.coverage).toEqual({ from: "2026-11-23", to: "2026-11-24" });
    expect(payload.reason).toContain("No hay dato");
  });

  it("distingue «no hay dato» de «hay dato y el día está libre»", async () => {
    const client = start("ana");
    await client.request(1, "initialize", {});
    const conDato = await client.call(2, "health_notes");
    expect(conDato.structuredContent.status).toBe("ok");

    const bob = start("bob");
    await bob.request(1, "initialize", {});
    const vacio = await bob.call(2, "health_notes");
    expect(vacio.structuredContent.status).toBe("no_data");
    expect(vacio.isError).toBe(false);
  });
});

describe("tramas malformadas", () => {
  it("una trama que no es JSON devuelve -32700 y el proceso sigue vivo", async () => {
    const client = start("ana");
    client.write("{esto no es json");
    const frame = await client.next();
    expect(frame.error?.code).toBe(-32700);
    expect(frame.id).toBeNull();

    const alive = await client.request(1, "tools/list");
    expect(alive.result.tools).toHaveLength(4);
  });

  it("una petición sin método devuelve -32600 conservando el id", async () => {
    const client = start("ana");
    client.write(JSON.stringify({ jsonrpc: "2.0", id: 7 }));
    const frame = await client.next();
    expect(frame.error?.code).toBe(-32600);
    expect(frame.id).toBe(7);
  });

  it("un método desconocido devuelve -32601 y una tool inexistente -32602", async () => {
    const client = start("ana");
    const desconocido = await client.request(1, "resources/list");
    expect(desconocido.error?.code).toBe(-32601);
    const inexistente = await client.request(2, "tools/call", { name: "no_existe", arguments: {} });
    expect(inexistente.error?.code).toBe(-32602);
  });

  it("argumentos inválidos son un error de tool, no de protocolo", async () => {
    const client = start("ana");
    const result = await client.call(2, "calendar_free_busy", { from: "ayer" });
    expect(result.isError).toBe(true);
    expect(result.structuredContent.status).toBe("invalid_input");
  });
});

describe("fixture", () => {
  it("falla en stderr y con código ≠ 0 si falta MOCK_FIXTURE", async () => {
    const child = spawn(process.execPath, [server], { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, MOCK_FIXTURE: undefined } });
    const [code, stderr] = await collect(child);
    expect(code).toBe(1);
    expect(stderr).toContain("falta MOCK_FIXTURE");
  });

  it("falla nombrando el campo cuando el fixture no cumple el esquema", async () => {
    const child = spawn(process.execPath, [server], { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, MOCK_FIXTURE: server } });
    const [code, stderr] = await collect(child);
    expect(code).toBe(1);
    expect(stderr).toContain("no es JSON válido");
  });
});

function collect(child: ReturnType<typeof spawn>): Promise<[number | null, string]> {
  let stderr = "";
  child.stderr!.setEncoding("utf8");
  child.stderr!.on("data", (chunk: string) => {
    stderr += chunk;
  });
  return new Promise((resolve) => child.on("exit", (code) => resolve([code, stderr])));
}
