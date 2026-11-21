import type { Category, Principal } from "@team-31/protocol";

export type Weekday = "sunday" | "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday";
export type CastMember = {
  id: string;
  name: string;
  headline: string;
  availability: Partial<Record<Weekday, string[]>>;
  interests: string[];
  health: { label: string; value: string }[];
  shares: Category[];
};

export const weekdays: Weekday[];
export const cast: CastMember[];
export const healthCategory: string;
export function castMember(id: string): CastMember | undefined;
export function castAddress(id: string): string;
export function castPrincipal(id: string): Principal;
export function castAvailability(
  member: CastMember,
  args: { date: string; start: string; durationMinutes: number },
): { available: boolean; freeSlots: string[] } | null;
