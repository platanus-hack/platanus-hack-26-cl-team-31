// Ventana de tiempo global del encabezado ([1h ▾]). La usan Resumen y Errores.
import * as React from "react"
import { Window } from "@shared/contract"

const STORAGE_KEY = "sideband-admin-window"

export const windowLabel: Record<Window, string> = {
  "15m": "15 min",
  "1h": "1 hora",
  "24h": "24 horas",
  "7d": "7 días",
}

// Para usar dentro de una frase: «en la última hora».
export const windowPhrase: Record<Window, string> = {
  "15m": "los últimos 15 min",
  "1h": "la última hora",
  "24h": "las últimas 24 horas",
  "7d": "los últimos 7 días",
}

// Para empezar una frase: «Última hora · actualizado…».
export const windowTitle: Record<Window, string> = {
  "15m": "Últimos 15 min",
  "1h": "Última hora",
  "24h": "Últimas 24 horas",
  "7d": "Últimos 7 días",
}

export const windowMs: Record<Window, number> = {
  "15m": 15 * 60_000,
  "1h": 3_600_000,
  "24h": 86_400_000,
  "7d": 7 * 86_400_000,
}

type WindowState = { window: Window; setWindow: (window: Window) => void }
const WindowContext = React.createContext<WindowState | null>(null)

function readStored(): Window {
  try {
    const parsed = Window.safeParse(localStorage.getItem(STORAGE_KEY))
    return parsed.success ? parsed.data : "1h"
  } catch {
    return "1h"
  }
}

export function WindowProvider({ children }: { children: React.ReactNode }) {
  const [window, setWindowState] = React.useState<Window>(readStored)
  const setWindow = React.useCallback((next: Window) => {
    setWindowState(next)
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // Preferencia solo en memoria.
    }
  }, [])
  const value = React.useMemo(
    () => ({ window, setWindow }),
    [window, setWindow]
  )
  return (
    <WindowContext.Provider value={value}>{children}</WindowContext.Provider>
  )
}

export function useTimeWindow() {
  const context = React.useContext(WindowContext)
  if (!context) throw new Error("useTimeWindow requiere WindowProvider")
  return context
}
