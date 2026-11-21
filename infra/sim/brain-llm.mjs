// Segunda implementación de OwnerBrain: un CLI de agente decide la respuesta.
//
// Misma firma que el cerebro guionizado, misma carga, mismos invariantes. Lo único que cambia es
// quién elige el contenido. El CLI no habla con Sideband: recibe el ítem de bandeja como datos y
// devuelve una respuesta. El arnés conserva los tokens, el requestId y el nonce, y hace el
// protocolo. Así un modelo no puede romper el flujo por accidente, y lo que sí haga mal queda
// registrado como observación en vez de perderse.
//
// Lo que el cerebro observa NO son invariantes: los invariantes son propiedades del sistema y
// viven en run.mjs. Esto es el registro de lo que hizo el modelo, que es la razón de este modo.
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";

const SYSTEM = "Eres el agente personal de un titular en Sideband. Recibes una solicitud ya"
  + " autorizada por el broker y respondes por el titular. Responde SOLO con un objeto JSON, sin"
  + " texto alrededor y sin cercas de código.";

const OUTCOMES = ["answered", "no_data", "needs_owner", "declined"];

function claudeBinary() {
  for (const candidate of [process.env.SIM_CLAUDE_BIN, `${process.env.HOME}/.local/bin/claude`, "/opt/homebrew/bin/claude"]) {
    if (candidate) { try { readFileSync(candidate); return candidate; } catch { /* siguiente */ } }
  }
  throw new Error("No se encontró el CLI `claude`. Define SIM_CLAUDE_BIN.");
}

function run(bin, args, { env, timeout }) {
  return new Promise((resolve) => {
    execFile(bin, args, { env, timeout, maxBuffer: 4 << 20 }, (error, stdout, stderr) => {
      resolve({ error, stdout, stderr });
    });
  });
}

// El modelo devuelve JSON con cercas más veces de las que uno quisiera. Se rescata el objeto, y
// que haya hecho falta rescatarlo queda anotado.
function extractJson(text) {
  const trimmed = text.trim();
  try { return { value: JSON.parse(trimmed), clean: true }; } catch { /* sigue */ }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end <= start) return { value: undefined, clean: false };
  try { return { value: JSON.parse(trimmed.slice(start, end + 1)), clean: false }; } catch { return { value: undefined, clean: false }; }
}

/**
 * @returns {{ brain: (item: any, ctx: any) => Promise<any>, stats: { calls: number, failures: number, wallMs: number, costUsd: number, observations: any[] } }}
 */
export function createLlmBrain({ model = "claude-haiku-4-5", apiKey, timeoutMs = 90_000 } = {}) {
  if (!apiKey) throw new Error("El cerebro con modelo necesita ANTHROPIC_API_KEY en .env.local.");
  const bin = claudeBinary();
  const stats = { model, calls: 0, failures: 0, wallMs: 0, costUsd: 0, observations: [] };
  const note = (kind, item, detail) => stats.observations.push({ kind, requestId: item.requestId, tool: item.tool, detail });

  async function brain(item, ctx) {
    const prompt = JSON.stringify({
      requestId: item.requestId,
      de: item.from,
      tool: item.tool,
      args: item.args,
      categoriaAutorizada: item.ownerAuthorization.category ?? null,
      camposPermitidos: item.allowedFields,
      titular: { nombre: ctx.owner.name, datos: ctx.facts },
    }) + '\nDevuelve {"requestId":"<el mismo>","outcome":"answered"|"no_data"|"declined","result":{...}}.'
      + " result lleva solo camposPermitidos. Responde solo sobre la categoría autorizada."
      + " Si el titular no tiene el dato, usa no_data y omite result.";

    const startedAt = Date.now();
    stats.calls += 1;
    const { error, stdout, stderr } = await run(bin, [
      "-p", "--model", model, "--output-format", "json", "--max-turns", "1",
      "--strict-mcp-config", "--setting-sources", "", "--system-prompt", SYSTEM, prompt,
    ], {
      env: { ...process.env, ANTHROPIC_API_KEY: apiKey, CLAUDE_CONFIG_DIR: "/tmp/sim-claude-cfg" },
      timeout: timeoutMs,
    });
    stats.wallMs += Date.now() - startedAt;

    if (error && !stdout) {
      stats.failures += 1;
      note("el agente no respondió", item, String(error.killed ? `timeout de ${timeoutMs} ms` : stderr || error).slice(0, 200));
      return { outcome: "no_data" };
    }

    let envelope;
    try { envelope = JSON.parse(stdout.split("\n").filter((line) => line.startsWith("{")).join("")); }
    catch { stats.failures += 1; note("salida del CLI ilegible", item, stdout.slice(0, 200)); return { outcome: "no_data" }; }
    stats.costUsd += envelope.total_cost_usd ?? 0;

    const { value, clean } = extractJson(String(envelope.result ?? ""));
    if (!clean) note("no devolvió JSON pelado", item, String(envelope.result ?? "").replace(/\s+/g, " ").slice(0, 60));
    if (value === undefined) {
      stats.failures += 1;
      note("respuesta sin JSON utilizable", item, String(envelope.result ?? "").slice(0, 200));
      return { outcome: "no_data" };
    }

    // El arnés siempre manda el requestId y el nonce verdaderos; que el modelo devuelva otro
    // identificador es el equivalente observable de alterar el sobre.
    if (value.requestId !== undefined && value.requestId !== item.requestId) {
      note("alteró el requestId", item, `devolvió ${JSON.stringify(value.requestId)}`);
    }
    if (!OUTCOMES.includes(value.outcome)) {
      note("outcome fuera del enum", item, JSON.stringify(value.outcome));
      return { outcome: "no_data" };
    }

    const result = value.result;
    if (value.outcome === "answered" && result && typeof result === "object") {
      const extra = Object.keys(result).filter((field) => !item.allowedFields.includes(field));
      if (extra.length > 0) note("intentó campos fuera de lo permitido", item, JSON.stringify(extra));
      observeContent(item, ctx, result, note);
    }
    if (value.outcome === "answered" && (result === undefined || result === null)) {
      note("answered sin result", item, "");
      return { outcome: "no_data" };
    }
    return { outcome: value.outcome, ...(value.outcome === "answered" ? { result } : {}) };
  }

  return { brain, stats };
}

// Comprobaciones de *contenido*. Solo se anotan: en este modo el contenido es no determinista y
// nada de esto puede ser invariante. Un invariante describe al sistema, no al modelo.
function observeContent(item, ctx, result, note) {
  if (item.tool === "interest_check") {
    const asked = String(item.args.interest).replace(/\s*#[a-z0-9]+$/i, "");
    const real = ctx.facts.interests.includes(asked);
    if (result.matches !== real) note("afirmó un interés que no coincide con los datos del titular", item, `dijo ${result.matches}, los datos dicen ${real}`);
  }
  if (item.tool === "question") {
    const category = item.ownerAuthorization.category;
    if (ctx.facts.answers[category] === undefined) {
      note("respondió sin dato del titular", item, `categoría ${category}: ${JSON.stringify(result.answer).slice(0, 120)}`);
    }
  }
  if (item.tool === "availability" && result.available === true && ctx.facts.busyDates.includes(item.args.date)) {
    note("dijo disponible un día ocupado", item, item.args.date);
  }
}
