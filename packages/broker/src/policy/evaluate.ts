import {
  fieldsOf,
  type Address,
  type SharingRules,
  type ToolName,
  type ToolResult,
} from "@team-31/protocol";

export type EvaluateInput = {
  rules: SharingRules;
  from: Address;
  to: Address;
  tool: ToolName;
};

export type Decision =
  | { kind: "public"; result: ToolResult }
  | { kind: "allow"; allowedFields: string[]; guidance: string; rule: string }
  | { kind: "ask_owner"; reason: string }
  | { kind: "deny"; reason: string };

function allow(
  source: string,
  tool: ToolName,
  allowedFields: string[],
  guidance: string,
): Decision {
  return {
    kind: "allow",
    allowedFields,
    guidance,
    rule: `${source} pueden usar ${tool}: ${allowedFields.join(", ")}`,
  };
}

export const connectGuidance =
  "Pregúntale a tu titular si quiere conectar con esta dirección. Responde answered con accepted: true solo si lo confirma; si no, accepted: false.";

export function evaluate({ rules, from, tool }: EvaluateInput): Decision {
  if (rules.blocked.includes(from)) {
    return { kind: "deny", reason: "remitente bloqueado" };
  }

  if (tool === "connect") {
    return allow("solicitud de conexión", tool, ["accepted"], connectGuidance);
  }

  if (tool === "profile") {
    return rules.publicProfile
      ? { kind: "public", result: rules.publicProfile }
      : { kind: "deny", reason: "perfil público no configurado" };
  }

  const personalGrant = rules.people[from]?.find((grant) => grant.tool === tool);
  if (personalGrant) {
    return allow("excepción personal", tool, [...personalGrant.fields], personalGrant.guidance);
  }

  const circles = new Set<string>();
  const fields = new Set<string>();
  const guidance: string[] = [];

  for (const [circle, members] of Object.entries(rules.circles)) {
    if (!members.includes(from)) continue;

    const grants = Object.hasOwn(rules.grants, circle) && rules.grants[circle];
    if (!grants) continue;

    for (const grant of grants) {
      if (grant.tool !== tool) continue;
      if (grant.never) {
        return { kind: "deny", reason: `el círculo ${circle} tiene una regla de nunca compartir` };
      }

      circles.add(circle);
      for (const field of grant.fields) fields.add(field);
      guidance.push(grant.guidance);
    }
  }

  if (circles.size > 0) {
    const allowedFields = fieldsOf(tool).filter((field) => fields.has(field));
    return allow([...circles].join(", "), tool, allowedFields, guidance.join(" · "));
  }

  const reason = "sin regla de uso compartido";
  return { kind: rules.defaultForUnknown, reason };
}
