// Reglas heredadas de apps/broker/src/log.ts#logFailure: nunca se registran mensajes crudos,
// causas ni valores de HTTP, destinos de aviso o Postgres. Solo el tipo, los códigos de issues
// de zod, un código de sistema y los frames que apuntan al código del repo.

const MAX_FRAMES = 10;
// apps/<x>/<src|dist|…>/ruta:línea:columna o packages/<x>/… — nunca node_modules.
const REPO_FRAME = /\b((?:apps|packages)\/[\w.-]+\/(?:src|dist|server|app|lib|scripts|shared)\/[\w/.[\]()@-]+:\d+:\d+)\)?$/;
const SAFE_NAME = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const SAFE_CODE = /^[A-Za-z0-9_.-]{1,32}$/;

export interface ErrorSummary {
  type: string;
  issues?: string;
  frames?: string;
  code?: string;
}

function isZodError(error: unknown): error is { issues: Array<{ code?: unknown }> } {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: unknown }).name === "ZodError" &&
    Array.isArray((error as { issues?: unknown }).issues)
  );
}

export function repoFrames(stack: string | undefined): string[] {
  if (!stack) return [];
  const frames: string[] = [];
  for (const line of stack.split("\n").slice(1)) {
    if (line.includes("node_modules")) continue;
    const frame = REPO_FRAME.exec(line)?.[1];
    if (frame) frames.push(frame);
    if (frames.length >= MAX_FRAMES) break;
  }
  return frames;
}

/** Resume un error sin incluir su mensaje ni sus valores. */
export function summarizeError(error: unknown): ErrorSummary {
  if (isZodError(error)) {
    const codes = [...new Set(error.issues.map((issue) => String(issue.code ?? "unknown")))];
    const frames = error instanceof Error ? repoFrames(error.stack) : [];
    return {
      type: "invalid_schema",
      issues: codes.join(",").slice(0, 512),
      ...(frames.length ? { frames: frames.join("\n").slice(0, 2048) } : {}),
    };
  }
  if (error instanceof Error) {
    const ctorName = error.constructor?.name;
    const type = ctorName && SAFE_NAME.test(ctorName) && ctorName !== "Object"
      ? ctorName
      : SAFE_NAME.test(error.name) ? error.name : "Error";
    const rawCode = (error as { code?: unknown }).code;
    const code = typeof rawCode === "string" && SAFE_CODE.test(rawCode) ? rawCode : undefined;
    const frames = repoFrames(error.stack);
    return {
      type,
      ...(code ? { code } : {}),
      ...(frames.length ? { frames: frames.join("\n").slice(0, 2048) } : {}),
    };
  }
  return { type: error === null ? "null" : typeof error };
}
