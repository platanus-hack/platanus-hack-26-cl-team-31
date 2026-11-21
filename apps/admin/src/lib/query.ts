// QueryClient del panel: datos frescos por poco tiempo (es un panel de observabilidad),
// sin reintentos en errores 4xx y manejo global de sesión vencida o no fresca.
import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import { isApiError } from "@/lib/api"

type Listener = () => void
const reauthListeners = new Set<Listener>()

// Pide al usuario volver a entrar (acciones sensibles con sesión no fresca).
export function requestReauth() {
  for (const listener of reauthListeners) listener()
}

export function onReauthRequested(listener: Listener) {
  reauthListeners.add(listener)
  return () => {
    reauthListeners.delete(listener)
  }
}

function handleAuthError(error: unknown) {
  if (isApiError(error, "unauthorized")) {
    // La sesión venció o fue revocada: la consulta de sesión decide si mostrar el login.
    void queryClient.invalidateQueries({ queryKey: ["session"] })
    return true
  }
  if (isApiError(error, "not_fresh")) {
    requestReauth()
    return true
  }
  return false
}

export const queryClient: QueryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error, query) => {
      if (query.queryKey[0] === "session") return
      handleAuthError(error)
    },
  }),
  mutationCache: new MutationCache({
    onError: (error) => {
      if (handleAuthError(error)) return
      if (isApiError(error, "forbidden"))
        toast.error("No tienes permiso para esta acción.")
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      refetchOnWindowFocus: true,
      retry: (failureCount, error) => {
        if (isApiError(error) && error.status >= 400 && error.status < 500)
          return false
        if (isApiError(error, "invalid_response")) return false
        return failureCount < 2
      },
    },
    mutations: { retry: false, gcTime: 0 },
  },
})
