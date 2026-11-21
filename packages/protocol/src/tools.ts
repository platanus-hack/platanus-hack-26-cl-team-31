import { z } from "zod";
import { categories, Category } from "./categories.js";
import { Sharing } from "./sharing.js";

export const ToolName = z.enum(["profile", "availability", "question", "interest_check", "connect"]);
export type ToolName = z.infer<typeof ToolName>;

// Execution is fixed by the service contract. It is never an argument supplied by the sender.
export const toolExecution = {
  profile: "stored",
  availability: "owner_runtime",
  question: "owner_runtime",
  interest_check: "owner_runtime",
  connect: "owner_runtime",
} as const satisfies Record<ToolName, "stored" | "owner_runtime">;

export type RuntimeTool = {
  [K in ToolName]: (typeof toolExecution)[K] extends "owner_runtime" ? K : never;
}[ToolName];

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
  interest_check: z.strictObject({ interest: z.string().trim().min(1).max(128) }),
  availability: z.strictObject({
    date: z.iso.date(),
    start: time,
    durationMinutes: z.number().int().min(15).max(480),
    timezone,
  }),
  // Questions stored before categories carry none: they read as open questions.
  question: z.strictObject({ text: z.string().min(1).max(1000), category: Category.default("general") }),
  connect: z.strictObject({ share: Sharing.optional() }),
} as const;

export const ToolResultSchemas = {
  interest_check: z.object({ matches: z.boolean() }),
  profile: z.object({
    displayName: z.string(),
    headline: z.string().optional(),
  }),
  availability: z.object({
    available: z.boolean(),
    freeSlots: z.array(freeSlot).optional(),
  }),
  question: z.object({ answer: z.string().min(1).max(1000) }),
  connect: z.object({ accepted: z.boolean() }),
} as const;

export const ToolResult = z.union([
  ToolResultSchemas.profile,
  ToolResultSchemas.availability,
  ToolResultSchemas.question,
  ToolResultSchemas.interest_check,
  ToolResultSchemas.connect,
]);
export type ToolResult = z.infer<typeof ToolResult>;

export function fieldsOf(tool: ToolName): string[] {
  return Object.keys(ToolResultSchemas[tool].shape);
}

export const Capability = z.object({
  tool: ToolName,
  execution: z.enum(["stored", "owner_runtime"]),
  inputSchema: z.record(z.string(), z.unknown()),
  allowedFields: z.array(z.string()),
  // The categories the sender may ask about with this tool. Empty for tools outside the catalog.
  categories: z.array(Category),
});
export type Capability = z.infer<typeof Capability>;

export function describeTool(tool: ToolName, allowed: Category[]): Capability {
  return {
    tool, execution: toolExecution[tool], inputSchema: z.toJSONSchema(ToolArgs[tool]),
    allowedFields: fieldsOf(tool), categories: allowed,
  };
}

// A question names its category. Every other tool belongs to at most one.
export function categoryOf(tool: ToolName, args: unknown): Category | undefined {
  if (tool === "question") return ToolArgs.question.safeParse(args).data?.category;
  return Category.options.find((category) => categories[category].tools.includes(tool));
}
