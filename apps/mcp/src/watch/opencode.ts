import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";

const run = promisify(execFile);
export const openCodeSessionId = z.string().regex(/^ses_[A-Za-z0-9]+$/);

async function api(args: string[], signal: AbortSignal): Promise<unknown> {
  const { stdout } = await run("opencode", ["api", ...args], { timeout: 15_000, signal });
  return JSON.parse(stdout);
}

export async function openCodeNotifier(sessionId: string, signal: AbortSignal, call = api) {
  const path = `/api/session/${openCodeSessionId.parse(sessionId)}`;
  const session = z.object({ data: z.object({ id: z.literal(sessionId) }) });
  if (!session.safeParse(await call(["get", path], signal)).success) throw new Error("Sesión no disponible.");

  return async (requestId: string) => {
    z.uuid().parse(requestId);
    const notice = {
      text: `Aviso automático de Sideband: llegó una solicitud nueva (${requestId}). Muéstrale este aviso y el ID al titular en el chat. No uses herramientas, no leas la bandeja y no respondas al remitente.`,
      description: "Nueva solicitud de Sideband",
      metadata: { source: "sideband", requestId },
      delivery: "queue",
      resume: true,
    };
    const accepted = z.object({ data: z.object({ sessionID: z.literal(sessionId), type: z.literal("synthetic") }) });
    if (!accepted.safeParse(await call(["post", `${path}/synthetic`, "--data", JSON.stringify(notice)], signal)).success) {
      throw new Error("OpenCode no aceptó el aviso.");
    }
  };
}
