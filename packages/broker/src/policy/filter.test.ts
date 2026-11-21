import type { ToolName } from "@team-31/protocol";
import { describe, expect, it } from "vitest";
import { BrokerError } from "../errors.js";
import { filterResult, type FilteredResult } from "./index.js";

describe("filterResult", () => {
  it.each<{
    label: string;
    tool: ToolName;
    raw: unknown;
    allowedFields: string[];
    expected: FilteredResult;
  }>([
    {
      label: "elimina campos extra aunque aparezcan en el permiso",
      tool: "availability",
      raw: { available: true, freeSlots: ["09:00-09:30"], note: "Privado" },
      allowedFields: ["available", "note"],
      expected: { result: { available: true }, delivered: ["available"], dropped: ["freeSlots", "note"] },
    },
    {
      label: "conserva todos los campos permitidos que están presentes",
      tool: "availability",
      raw: { available: true, freeSlots: ["09:00-09:30"] },
      allowedFields: ["available", "freeSlots"],
      expected: {
        result: { available: true, freeSlots: ["09:00-09:30"] },
        delivered: ["available", "freeSlots"],
        dropped: [],
      },
    },
    {
      label: "permite omitir un campo opcional",
      tool: "profile",
      raw: { displayName: "Sideband" },
      allowedFields: ["displayName", "headline"],
      expected: { result: { displayName: "Sideband" }, delivered: ["displayName"], dropped: [] },
    },
    {
      label: "conserva la respuesta de texto sin alterar su contenido",
      tool: "question",
      raw: { answer: "Sí.", internalReason: "Privado" },
      allowedFields: ["answer"],
      expected: { result: { answer: "Sí." }, delivered: ["answer"], dropped: ["internalReason"] },
    },
  ])("$label", ({ tool, raw, allowedFields, expected }) => {
    expect(filterResult(tool, raw, allowedFields)).toEqual(expected);
  });

  it.each([
    { label: "falta available", raw: { freeSlots: [] }, allowedFields: ["available"], field: "available" },
    {
      label: "el permiso no incluye el campo obligatorio available",
      raw: { available: true, freeSlots: [] },
      allowedFields: ["freeSlots"],
      field: "available",
    },
    {
      label: "el dato opcional se valida antes de eliminarlo",
      raw: { available: true, freeSlots: ["hora desconocida"] },
      allowedFields: ["available"],
      field: "freeSlots.0",
    },
    { label: "el resultado es nulo", raw: null, allowedFields: ["available"], field: "resultado" },
  ])("$label", ({ raw, allowedFields, field }) => {
    const filter = () => filterResult("availability", raw, allowedFields);
    expect(filter).toThrow(BrokerError);
    expect(filter).toThrow(expect.objectContaining({
      code: "invalid_input",
      message: `La respuesta no cumple el formato de availability: revisa ${field}.`,
    }));
  });
});
