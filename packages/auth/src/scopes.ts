import { Scope } from "@team-31/protocol";

export const SCOPES = {
  "nexo:ask": "Hacer preguntas a otras personas en tu nombre",
  "nexo:inbox": "Leer las solicitudes que te envían y administrar sus avisos",
  "nexo:reply": "Responder solicitudes según tus reglas",
  "nexo:status": "Ver las respuestas a tus preguntas",
} as const satisfies Record<Scope, string>;

export function parseScopes(claim: unknown): Scope[] {
  if (typeof claim !== "string") return [];

  const scopes = new Set(claim.split(" "));
  return Scope.options.filter((scope) => scopes.has(scope));
}
