import { z } from "zod";

export const ToolName = z.enum(["profile", "availability", "question"]);
export type ToolName = z.infer<typeof ToolName>;

const timePattern = "(?:[01][0-9]|2[0-3]):[0-5][0-9]";
const time = z.string().regex(new RegExp(`^${timePattern}$`));
const freeSlot = z.string().regex(new RegExp(`^${timePattern}-${timePattern}$`));

const timezones = new Set(Intl.supportedValuesOf("timeZone"));
timezones.add("UTC");

const timezone = z.string().refine(
  (value) => {
    try {
      const canonical = new Intl.DateTimeFormat("en", { timeZone: value }).resolvedOptions().timeZone;
      return timezones.has(canonical);
    } catch {
      return false;
    }
  },
  "La zona horaria debe ser un identificador IANA.",
);

export const ToolArgs = {
  profile: z.strictObject({}),
  availability: z.strictObject({
    date: z.iso.date(),
    start: time,
    durationMinutes: z.number().int().min(15).max(480),
    timezone,
  }),
  question: z.strictObject({ text: z.string().min(1).max(1000) }),
} as const;

export const ToolResultSchemas = {
  profile: z.object({
    displayName: z.string(),
    headline: z.string().optional(),
  }),
  availability: z.object({
    available: z.boolean(),
    freeSlots: z.array(freeSlot).optional(),
  }),
  question: z.object({ answer: z.string().min(1).max(1000) }),
} as const;

export const ToolResult = z.union([
  ToolResultSchemas.profile,
  ToolResultSchemas.availability,
  ToolResultSchemas.question,
]);
export type ToolResult = z.infer<typeof ToolResult>;

export function fieldsOf(tool: ToolName): string[] {
  return Object.keys(ToolResultSchemas[tool].shape);
}
