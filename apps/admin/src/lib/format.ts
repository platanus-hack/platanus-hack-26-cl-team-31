// Formato de fechas, duraciones y números con Intl (sin librerías).
import { useSyncExternalStore } from "react"

const LOCALE = "es-CL"

const relative = new Intl.RelativeTimeFormat("es", {
  numeric: "auto",
  style: "short",
})
const absolute = new Intl.DateTimeFormat(LOCALE, {
  dateStyle: "medium",
  timeStyle: "medium",
})
const timeOnly = new Intl.DateTimeFormat(LOCALE, {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
})
const shortTime = new Intl.DateTimeFormat(LOCALE, {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
})
const dayTime = new Intl.DateTimeFormat(LOCALE, {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
})
const integer = new Intl.NumberFormat(LOCALE)
const seconds1 = new Intl.NumberFormat(LOCALE, {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
})
const seconds2 = new Intl.NumberFormat(LOCALE, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})
const percent = new Intl.NumberFormat(LOCALE, {
  style: "percent",
  maximumFractionDigits: 1,
})

const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 31_536_000_000],
  ["month", 2_592_000_000],
  ["day", 86_400_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
  ["second", 1_000],
]

export function formatRelative(iso: string, now = Date.now()): string {
  const diff = Date.parse(iso) - now
  const abs = Math.abs(diff)
  // El reloj compartido avanza cada pocos segundos y el servidor puede ir algo adelantado:
  // un instante "futuro" muy cercano también es «ahora».
  if (abs < 5_000 || (diff > 0 && diff < 30_000)) return "ahora"
  for (const [unit, ms] of units) {
    if (abs >= ms || unit === "second")
      return relative.format(Math.round(diff / ms), unit)
  }
  return relative.format(0, "second")
}

export const formatAbsolute = (iso: string) => absolute.format(new Date(iso))
export const formatClock = (iso: string) => timeOnly.format(new Date(iso))
export const formatShortTime = (ms: number) => shortTime.format(new Date(ms))
export const formatDayTime = (ms: number) => dayTime.format(new Date(ms))
export const formatNumber = (n: number) => integer.format(n)
export const formatPercent = (ratio: number) => percent.format(ratio)

export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "—"
  if (ms < 1) return "<1 ms"
  if (ms < 1_000) return `${Math.round(ms)} ms`
  if (ms < 60_000)
    return `${(ms < 10_000 ? seconds2 : seconds1).format(ms / 1_000)} s`
  const minutes = Math.floor(ms / 60_000)
  const seconds = Math.round((ms % 60_000) / 1_000)
  return seconds ? `${minutes} min ${seconds} s` : `${minutes} min`
}

// Reloj compartido: un solo intervalo para todas las fechas relativas de la página.
let now = Date.now()
const listeners = new Set<() => void>()
let timer: ReturnType<typeof setInterval> | undefined

function subscribe(listener: () => void) {
  listeners.add(listener)
  if (!timer) {
    timer = setInterval(() => {
      now = Date.now()
      for (const l of listeners) l()
    }, 5_000)
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && timer) {
      clearInterval(timer)
      timer = undefined
    }
  }
}

export function useNow(): number {
  return useSyncExternalStore(subscribe, () => now)
}
