// The demo cast: five fictional owners with a public profile, private data and what each one
// shares with the owner who seeds them. The data is made up and lives in cast.json.
import { ADDRESS_DOMAIN, Category, LocalPart } from "@team-31/protocol";
import { z } from "zod";
import data from "./cast.json" with { type: "json" };

export const weekdays = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const slot = z.string().regex(/^\d{2}:\d{2}-\d{2}:\d{2}$/);

const Member = z.strictObject({
  id: LocalPart,
  name: z.string().min(1),
  headline: z.string().min(1),
  // Free slots per weekday. A missing day means the owner keeps nothing for it.
  availability: z.partialRecord(z.enum(weekdays), z.array(slot)),
  interests: z.array(z.string().min(1)),
  // Entries of the vault category «Salud». `shares` with "health" lets the seeded owner read them.
  health: z.array(z.strictObject({ label: z.string().min(1), value: z.string().min(1) })),
  shares: z.array(Category),
});

export const cast = z.array(Member).parse(data);
export const healthCategory = "Salud";

export function castMember(id) {
  return cast.find(member => member.id === id);
}

export function castAddress(id) {
  return `${LocalPart.parse(id)}@${ADDRESS_DOMAIN}`;
}

// Same userId shape as the dev identity `demo-carla`, so Carla keeps her address.
export function castPrincipal(id) {
  const userId = "demo-" + LocalPart.parse(id);
  return { userId, agentId: userId + "-bot", scopes: ["sideband:inbox", "sideband:reply"] };
}

const minutes = (time) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));

// Answers an availability request from the member's slots for that weekday, or null without data.
export function castAvailability(member, { date, start, durationMinutes }) {
  const slots = member.availability[weekdays[new Date(date + "T12:00:00Z").getUTCDay()]];
  if (!slots) return null;
  const from = minutes(start);
  const available = slots.some(range => minutes(range.slice(0, 5)) <= from && from + durationMinutes <= minutes(range.slice(6)));
  return { available, freeSlots: slots };
}
