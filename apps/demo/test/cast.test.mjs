import { expect, it } from "vitest";
import { cast, castAvailability, castMember, castPrincipal } from "../src/cast.mjs";

const saturday = { date: "2026-11-28", timezone: "America/Santiago" };

it("responde disponibilidad con los bloques libres del día y null si no guardó ese día", () => {
  const carla = castMember("carla");
  expect(castAvailability(carla, { ...saturday, start: "11:00", durationMinutes: 60 })).toEqual({ available: true, freeSlots: ["10:00-13:00"] });
  expect(castAvailability(carla, { ...saturday, start: "12:30", durationMinutes: 60 })).toEqual({ available: false, freeSlots: ["10:00-13:00"] });
  expect(castAvailability(carla, { date: "2026-11-29", timezone: "UTC", start: "11:00", durationMinutes: 30 })).toEqual({ available: false, freeSlots: [] });
  expect(castAvailability(carla, { date: "2026-11-25", timezone: "UTC", start: "11:00", durationMinutes: 30 })).toBeNull();
});

it("da a cada integrante del elenco una identidad propia", () => {
  expect(new Set(cast.map(({ id }) => castPrincipal(id).userId)).size).toBe(cast.length);
  expect(castPrincipal("carla").userId).toBe("demo-carla");
});
