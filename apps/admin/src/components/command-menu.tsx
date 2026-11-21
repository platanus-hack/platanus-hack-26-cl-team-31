// ⌘K: saltar por request id, trace id, error id o persona, y navegar entre páginas.
import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import {
  BellRingIcon,
  BotIcon,
  BugIcon,
  InboxIcon,
  KeyRoundIcon,
  LayoutDashboardIcon,
  NetworkIcon,
  RadioIcon,
  ScrollTextIcon,
  UserIcon,
  UsersIcon,
  WaypointsIcon,
  type LucideIcon,
} from "lucide-react"
import { useNavigate } from "react-router"

import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command"
import { RequestStatusBadge } from "@/components/status"
import { api } from "@/lib/api"
import { useSession } from "@/lib/session"

const pages: Array<{
  title: string
  to: string
  icon: LucideIcon
  operatorOnly?: boolean
}> = [
  { title: "Resumen", to: "/", icon: LayoutDashboardIcon },
  { title: "Solicitudes", to: "/solicitudes", icon: InboxIcon },
  { title: "Trazas", to: "/trazas", icon: WaypointsIcon },
  { title: "En vivo", to: "/en-vivo", icon: RadioIcon },
  { title: "Flujo", to: "/flujo", icon: NetworkIcon },
  { title: "Errores", to: "/errores", icon: BugIcon },
  { title: "Personas", to: "/personas", icon: UsersIcon },
  { title: "Agentes", to: "/agentes", icon: BotIcon },
  { title: "Avisos", to: "/avisos", icon: BellRingIcon },
  { title: "Auditoría", to: "/auditoria", icon: ScrollTextIcon },
  {
    title: "Tokens MCP",
    to: "/tokens",
    icon: KeyRoundIcon,
    operatorOnly: true,
  },
]

type Jump = {
  kind: "request" | "trace" | "error" | "user"
  label: string
  to: string
  icon: LucideIcon
}

function jumpsFor(value: string): Jump[] {
  const v = value.trim()
  if (!v) return []
  const jumps: Record<Jump["kind"], Jump> = {
    request: {
      kind: "request",
      label: "Abrir solicitud",
      to: `/solicitudes/${encodeURIComponent(v)}`,
      icon: InboxIcon,
    },
    trace: {
      kind: "trace",
      label: "Abrir traza",
      to: `/trazas/${encodeURIComponent(v)}`,
      icon: WaypointsIcon,
    },
    error: {
      kind: "error",
      label: "Abrir error",
      to: `/errores/${encodeURIComponent(v)}`,
      icon: BugIcon,
    },
    user: {
      kind: "user",
      label: "Abrir persona",
      to: `/personas/${encodeURIComponent(v)}`,
      icon: UserIcon,
    },
  }
  let order: Jump["kind"][] = ["request", "trace", "error", "user"]
  if (/^[0-9a-f]{32}$/i.test(v)) order = ["trace", "request", "error", "user"]
  else if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(v))
    order = ["error", "trace", "request", "user"]
  else if (v.includes("@") || v.startsWith("usr_"))
    order = ["user", "request", "trace", "error"]
  return order.map((kind) => jumps[kind])
}

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = React.useState(value)
  React.useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return debounced
}

export function CommandMenu({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const navigate = useNavigate()
  const { isOperator } = useSession()
  const [search, setSearch] = React.useState("")
  const term = useDebounced(search.trim(), 200)
  const enabled = open && term.length >= 2

  const requests = useQuery({
    queryKey: ["cmdk-requests", term],
    queryFn: ({ signal }) =>
      api("requests", { query: { q: term, limit: 5 } }, { signal }),
    enabled,
    staleTime: 15_000,
  })
  const users = useQuery({
    queryKey: ["cmdk-users", term],
    queryFn: ({ signal }) =>
      api("users", { query: { q: term, limit: 5 } }, { signal }),
    enabled,
    staleTime: 15_000,
  })

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        onOpenChange(!open)
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [open, onOpenChange])

  function go(to: string) {
    onOpenChange(false)
    setSearch("")
    navigate(to)
  }

  const lower = search.trim().toLowerCase()
  const visiblePages = pages.filter(
    (p) =>
      (!p.operatorOnly || isOperator) &&
      (!lower || p.title.toLowerCase().includes(lower))
  )
  const jumps = jumpsFor(search)

  return (
    <CommandDialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) setSearch("")
      }}
      title="Buscar"
      description="Busca por request id, trace id, error id o persona"
    >
      <Command shouldFilter={false}>
        <CommandInput
          placeholder="Request id, trace id, error id, persona o página…"
          value={search}
          onValueChange={setSearch}
        />
        <CommandList className="max-h-96">
          <CommandEmpty>Sin resultados.</CommandEmpty>
          {jumps.length > 0 ? (
            <CommandGroup heading="Saltar a">
              {jumps.map((jump) => (
                <CommandItem
                  key={jump.kind}
                  value={`jump-${jump.kind}`}
                  onSelect={() => go(jump.to)}
                >
                  <jump.icon />
                  <span className="text-muted-foreground">{jump.label}</span>
                  <span className="truncate font-mono text-xs">
                    {search.trim()}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
          {requests.data && requests.data.items.length > 0 ? (
            <CommandGroup heading="Solicitudes">
              {requests.data.items.map((r) => (
                <CommandItem
                  key={r.id}
                  value={`req-${r.id}`}
                  onSelect={() => go(`/solicitudes/${r.id}`)}
                >
                  <InboxIcon />
                  <span className="font-mono text-xs">{r.id}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {r.fromAddress} → {r.toAddress}
                  </span>
                  <CommandShortcut>
                    <RequestStatusBadge status={r.status} />
                  </CommandShortcut>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
          {users.data && users.data.items.length > 0 ? (
            <CommandGroup heading="Personas">
              {users.data.items.map((u) => (
                <CommandItem
                  key={u.userId}
                  value={`user-${u.userId}`}
                  onSelect={() => go(`/personas/${u.userId}`)}
                >
                  <UserIcon />
                  <span>{u.displayName ?? u.address ?? u.userId}</span>
                  <span className="truncate font-mono text-xs text-muted-foreground">
                    {u.address}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
          {visiblePages.length > 0 ? (
            <>
              {jumps.length > 0 ? <CommandSeparator /> : null}
              <CommandGroup heading="Páginas">
                {visiblePages.map((page) => (
                  <CommandItem
                    key={page.to}
                    value={`page-${page.to}`}
                    onSelect={() => go(page.to)}
                  >
                    <page.icon />
                    {page.title}
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          ) : null}
        </CommandList>
      </Command>
    </CommandDialog>
  )
}
