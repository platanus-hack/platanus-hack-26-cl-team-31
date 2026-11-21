import { z } from "zod";

export const Sharing = z.strictObject({
  availability: z.enum(["none", "busy", "slots"]),
  interests: z.boolean(),
  questions: z.boolean(),
});
export type Sharing = z.infer<typeof Sharing>;

export const basicSharing: Sharing = { availability: "busy", interests: true, questions: false };
export const noSharing: Sharing = { availability: "none", interests: false, questions: false };

export const sharingTools = ["availability", "interest_check", "question"] as const;
export type SharingTool = (typeof sharingTools)[number];

export function sharingFields(sharing: Sharing): Record<SharingTool, string[] | null> {
  return {
    availability: sharing.availability === "none" ? null
      : sharing.availability === "slots" ? ["available", "freeSlots"] : ["available"],
    interest_check: sharing.interests ? ["matches"] : null,
    question: sharing.questions ? ["answer"] : null,
  };
}

export function sharingOf(grants: readonly { tool: string; fields: readonly string[] }[]): Sharing {
  const availability = grants.find((grant) => grant.tool === "availability");
  return {
    availability: !availability ? "none" : availability.fields.includes("freeSlots") ? "slots" : "busy",
    interests: grants.some((grant) => grant.tool === "interest_check"),
    questions: grants.some((grant) => grant.tool === "question"),
  };
}
