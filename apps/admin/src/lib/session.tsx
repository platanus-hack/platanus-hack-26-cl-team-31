// Sesión del admin: consulta GET /api/admin/session y decide qué se muestra.
// 401 → login. not_fresh en una acción → diálogo para volver a entrar.
import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import type { AdminSession } from "@shared/contract"

import { api, isApiError, signOut } from "@/lib/api"
import { onReauthRequested, queryClient } from "@/lib/query"
import { LoginPage } from "@/pages/login"
import { ReauthDialog } from "@/components/reauth-dialog"
import { FullScreenMessage } from "@/components/full-screen-message"

type SessionState = {
  session: AdminSession
  isOperator: boolean
  logout: () => Promise<void>
}

const SessionContext = React.createContext<SessionState | null>(null)

export const sessionQueryKey = ["session"] as const

function clearSessionData() {
  queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== "session" })
}

export async function refreshSession() {
  clearSessionData()
  await queryClient.resetQueries({ queryKey: sessionQueryKey })
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [reauthOpen, setReauthOpen] = React.useState(false)
  const query = useQuery({
    queryKey: sessionQueryKey,
    queryFn: async ({ signal }) => {
      const previous = queryClient.getQueryData<AdminSession>(sessionQueryKey)
      try {
        const next = await api("session", undefined, { signal })
        if (previous && (previous.user.id !== next.user.id || previous.user.role !== next.user.role)) clearSessionData()
        return next
      } catch (error) {
        if (isApiError(error, "unauthorized") || isApiError(error, "forbidden")) clearSessionData()
        throw error
      }
    },
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    retry: false,
  })

  React.useEffect(() => onReauthRequested(() => setReauthOpen(true)), [])

  const logout = React.useCallback(async () => {
    await signOut()
    await refreshSession()
  }, [])

  const value = React.useMemo<SessionState | null>(
    () =>
      query.data
        ? {
            session: query.data,
            isOperator: query.data.user.role === "operator",
            logout,
          }
        : null,
    [query.data, logout]
  )

  if (query.isPending)
    return <FullScreenMessage loading title="Cargando sesión" />
  if (isApiError(query.error, "unauthorized")) return <LoginPage />
  if (isApiError(query.error, "forbidden")) return <LoginPage forbidden />
  if (query.isError && !query.data) {
    return (
      <FullScreenMessage
        title="No se pudo contactar al servidor admin"
        description={query.error.message}
        action={{ label: "Reintentar", onClick: () => void query.refetch() }}
      />
    )
  }
  if (!value) return <LoginPage />

  return (
    <SessionContext.Provider value={value}>
      {children}
      <ReauthDialog open={reauthOpen} onOpenChange={setReauthOpen} />
    </SessionContext.Provider>
  )
}

export function useSession() {
  const context = React.useContext(SessionContext)
  if (!context) throw new Error("useSession requiere SessionProvider")
  return context
}
