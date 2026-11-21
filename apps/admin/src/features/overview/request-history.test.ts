import { expect, it } from "vitest"
import type { RequestStatus } from "@team-31/protocol"
import { bucketize } from "./request-history"

const at = (minute: number) => minute * 60_000
const request = (minute: number, status: RequestStatus) => ({
  createdAt: new Date(at(minute)).toISOString(),
  status,
})

it("agrupa las solicitudes por fecha de creación y estado dentro de la ventana", () => {
  const buckets = bucketize([
    request(4, "answered"), // antes del primer intervalo
    request(5, "awaiting_agent"),
    request(9, "awaiting_owner"),
    request(10, "denied"),
    request(11, "declined"),
    request(12, "expired"),
    request(13, "delivery_failed"),
    request(14, "no_data"),
    request(64, "answered"),
    request(65, "answered"), // límite superior excluido
  ], "1h", at(64))

  expect(buckets).toHaveLength(12)
  expect(buckets[0]).toEqual({ t: at(5), ok: 0, neutral: 0, warn: 0, error: 0, open: 2 })
  expect(buckets[1]).toEqual({ t: at(10), ok: 0, neutral: 1, warn: 2, error: 2, open: 0 })
  expect(buckets.at(-1)).toEqual({ t: at(60), ok: 1, neutral: 0, warn: 0, error: 0, open: 0 })
})
