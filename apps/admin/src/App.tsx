import { createBrowserRouter, Navigate, Outlet } from "react-router"
import { RouterProvider } from "react-router/dom"

import { AppLayout, type RouteHandle } from "@/components/app-layout"
import { FullScreenMessage } from "@/components/full-screen-message"
import { SessionProvider } from "@/lib/session"
import { WindowProvider } from "@/lib/window"

const handle = (crumbs: RouteHandle["crumbs"]): RouteHandle => ({ crumbs })

// Cada página se carga bajo demanda (recharts, tablas…): el bundle inicial queda liviano.
function page<M extends Record<string, unknown>>(
  load: () => Promise<M>,
  name: keyof M & string
) {
  return async () => ({
    Component: (await load())[name] as React.ComponentType,
  })
}

function Root() {
  return (
    <SessionProvider>
      <WindowProvider>
        <Outlet />
      </WindowProvider>
    </SessionProvider>
  )
}

const router = createBrowserRouter([
  {
    element: <Root />,
    hydrateFallbackElement: <FullScreenMessage loading title="Cargando" />,
    children: [
      // El servidor redirige a /login?error=… si el callback de Google falla. Sin sesión,
      // SessionProvider muestra el login (con el error); con sesión, vuelve al resumen.
      { path: "login", element: <Navigate to="/" replace /> },
      {
        element: <AppLayout />,
        children: [
          {
            index: true,
            lazy: page(() => import("@/pages/overview"), "OverviewPage"),
            handle: handle(() => [{ label: "Resumen" }]),
          },
          {
            path: "solicitudes",
            lazy: page(() => import("@/pages/requests"), "RequestsPage"),
            handle: handle(() => [{ label: "Solicitudes" }]),
          },
          {
            path: "solicitudes/:id",
            lazy: page(
              () => import("@/pages/request-detail"),
              "RequestDetailPage"
            ),
            handle: handle((p) => [
              { label: "Solicitudes", to: "/solicitudes" },
              { label: p.id ?? "", mono: true },
            ]),
          },
          {
            path: "trazas",
            lazy: page(() => import("@/pages/traces"), "TracesPage"),
            handle: handle(() => [{ label: "Trazas" }]),
          },
          {
            path: "trazas/:id",
            lazy: page(() => import("@/pages/traces"), "TraceDetailPage"),
            handle: handle((p) => [
              { label: "Trazas", to: "/trazas" },
              { label: p.id ?? "", mono: true },
            ]),
          },
          {
            path: "en-vivo",
            lazy: page(() => import("@/pages/live"), "LivePage"),
            handle: handle(() => [{ label: "En vivo" }]),
          },
          {
            path: "errores",
            lazy: page(() => import("@/pages/errors"), "ErrorsPage"),
            handle: handle(() => [{ label: "Errores" }]),
          },
          {
            path: "errores/:id",
            lazy: page(() => import("@/pages/errors"), "ErrorsPage"),
            handle: handle((p) => [
              { label: "Errores", to: "/errores" },
              { label: p.id ?? "", mono: true },
            ]),
          },
          {
            path: "personas",
            lazy: page(() => import("@/pages/users"), "UsersPage"),
            handle: handle(() => [{ label: "Personas" }]),
          },
          {
            path: "personas/:id",
            lazy: page(() => import("@/pages/user-detail"), "UserDetailPage"),
            handle: handle((p) => [
              { label: "Personas", to: "/personas" },
              { label: p.id ?? "", mono: true },
            ]),
          },
          {
            path: "agentes",
            lazy: page(() => import("@/pages/agents"), "AgentsPage"),
            handle: handle(() => [{ label: "Agentes" }]),
          },
          {
            path: "avisos",
            lazy: page(() => import("@/pages/wakes"), "WakesPage"),
            handle: handle(() => [{ label: "Avisos" }]),
          },
          {
            path: "auditoria",
            lazy: page(() => import("@/pages/audit"), "AuditPage"),
            handle: handle(() => [{ label: "Auditoría" }]),
          },
          {
            path: "tokens",
            lazy: page(() => import("@/pages/tokens"), "TokensPage"),
            handle: handle(() => [{ label: "Tokens MCP" }]),
          },
          {
            path: "*",
            lazy: page(() => import("@/pages/not-found"), "NotFoundPage"),
            handle: handle(() => [{ label: "No encontrado" }]),
          },
        ],
      },
    ],
  },
])

export function App() {
  return <RouterProvider router={router} />
}

export default App
