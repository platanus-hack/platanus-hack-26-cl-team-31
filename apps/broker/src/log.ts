import { randomUUID } from "node:crypto";
import { ZodError } from "zod";

export function logFailure(operation: string, error: unknown): string {
  const errorId = randomUUID();
  // Avoid recording raw messages, causes or values from HTTP, wake targets or Postgres.
  const frames = error instanceof Error
    ? error.stack?.split("\n").slice(1).flatMap((line) => {
        const frame = /^\s+at .*?\b((?:apps|packages)\/broker\/(?:src|dist)\/[\w/.-]+:\d+:\d+)\)?$/.exec(line)?.[1];
        return frame ? [frame] : [];
      })
    : undefined;
  console.error("[broker] Error interno", {
    errorId,
    operation,
    type: error instanceof ZodError ? "invalid_schema" : error instanceof TypeError ? "TypeError" : typeof error,
    issues: error instanceof ZodError ? error.issues.map(({ code }) => code) : undefined,
    frames,
  });
  return errorId;
}
