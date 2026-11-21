import { SharingRules, type Address, type ToolName } from "@team-31/protocol";
import { describe, expect, it } from "vitest";
import { evaluate, type Decision } from "./index.js";

const owner = "owner@nexo.app";
const unknown = "unknown@nexo.app";
const friend = "friend@nexo.app";
const diego = "diego@nexo.app";
const blocked = "blocked@nexo.app";

const rules = SharingRules.parse({
  publicProfile: { displayName: "Nexo", headline: "Agenda" },
  blocked: [blocked],
  circles: {
    amigos: [friend, diego, blocked],
    trabajo: [diego],
    constructor: [unknown],
  },
  grants: {
    amigos: [
      { tool: "availability", fields: ["freeSlots", "available"], guidance: "Solo horarios" },
      { tool: "question", fields: ["answer"], never: true },
    ],
    trabajo: [{ tool: "availability", fields: ["available"], guidance: "En horario laboral" }],
  },
});

const neverAtWork = SharingRules.parse({
  ...rules,
  grants: {
    ...rules.grants,
    trabajo: [{ tool: "availability", fields: [], never: true }],
  },
});

describe("evaluate", () => {
  it.each<{
    label: string;
    from: Address;
    tool?: ToolName;
    overrides?: Partial<SharingRules>;
    expected: Decision;
  }>([
    {
      label: "un remitente bloqueado solicita el perfil público",
      from: blocked,
      tool: "profile",
      expected: { kind: "deny", reason: "remitente bloqueado" },
    },
    {
      label: "un remitente bloqueado tiene un permiso en su círculo",
      from: blocked,
      expected: { kind: "deny", reason: "remitente bloqueado" },
    },
    {
      label: "un desconocido solicita el perfil público",
      from: unknown,
      tool: "profile",
      expected: { kind: "public", result: { displayName: "Nexo", headline: "Agenda" } },
    },
    {
      label: "el dueño no configuró su perfil público",
      from: unknown,
      tool: "profile",
      overrides: { publicProfile: undefined },
      expected: { kind: "deny", reason: "perfil público no configurado" },
    },
    {
      label: "un amigo solicita disponibilidad",
      from: friend,
      expected: {
        kind: "allow",
        allowedFields: ["available", "freeSlots"],
        guidance: "Solo horarios",
        rule: "amigos pueden usar availability: available, freeSlots",
      },
    },
    {
      label: "Diego recibe la unión de los permisos de sus círculos",
      from: diego,
      expected: {
        kind: "allow",
        allowedFields: ["available", "freeSlots"],
        guidance: "Solo horarios · En horario laboral",
        rule: "amigos, trabajo pueden usar availability: available, freeSlots",
      },
    },
    {
      label: "el veto de trabajo prevalece sobre el permiso de amigos",
      from: diego,
      overrides: neverAtWork,
      expected: { kind: "deny", reason: "el círculo trabajo tiene una regla de nunca compartir" },
    },
    {
      label: "la excepción personal de Diego prevalece sobre el veto de trabajo",
      from: diego,
      overrides: {
        ...neverAtWork,
        people: {
          [diego]: [
            { tool: "question", fields: ["answer"], guidance: "" },
            { tool: "availability", fields: ["available"], guidance: "Solo confirma" },
          ],
        },
      },
      expected: {
        kind: "allow",
        allowedFields: ["available"],
        guidance: "Solo confirma",
        rule: "excepción personal pueden usar availability: available",
      },
    },
    {
      label: "un desconocido queda pendiente de autorización",
      from: unknown,
      expected: { kind: "ask_owner", reason: "sin regla de uso compartido" },
    },
    {
      label: "un desconocido queda denegado por defecto",
      from: unknown,
      overrides: { defaultForUnknown: "deny" },
      expected: { kind: "deny", reason: "sin regla de uso compartido" },
    },
    {
      label: "un grant de otra herramienta se ignora",
      from: diego,
      tool: "question",
      overrides: {
        grants: { trabajo: rules.grants.trabajo ?? [] },
        people: { [diego]: [{ tool: "availability", fields: ["available"], guidance: "" }] },
      },
      expected: { kind: "ask_owner", reason: "sin regla de uso compartido" },
    },
  ])("$label", ({ from, tool = "availability", overrides, expected }) => {
    expect(evaluate({ rules: { ...rules, ...overrides }, from, to: owner, tool })).toEqual(expected);
  });
});
