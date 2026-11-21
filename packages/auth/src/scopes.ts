import { Scope } from "@team-31/protocol";

export const SCOPES = {
  "sideband:ask": "Hacer preguntas a otras personas en tu nombre",
  "sideband:inbox": "Leer las solicitudes que te envían y administrar sus avisos",
  "sideband:reply": "Responder solicitudes según tus reglas",
  "sideband:status": "Ver las respuestas a tus preguntas",
  "sideband:accept": "Aceptar invitaciones y compartir las categorías que elijas con ese contacto",
} as const satisfies Record<Scope, string>;

export function parseScopes(claim: unknown): Scope[] {
  if (typeof claim !== "string") return [];

  const scopes = new Set(claim.split(" "));
  return Scope.options.filter((scope) => scopes.has(scope));
}
