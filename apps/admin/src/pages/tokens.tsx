import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import { AdminTokenScope, type AdminToken } from "@shared/contract"
import {
  KeyRoundIcon,
  LockIcon,
  PlusIcon,
  TrashIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { toast } from "sonner"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group"
import { Spinner } from "@/components/ui/spinner"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { CopyButton } from "@/components/copy-id"
import { DataTable } from "@/components/data-table"
import { ErrorState, Muted, Page, PageHeader, Panel } from "@/components/page"
import { RelativeTime } from "@/components/relative-time"
import { ToneBadge } from "@/components/status"
import { api, isApiError } from "@/lib/api"
import { requestReauth } from "@/lib/query"
import { useSession } from "@/lib/session"
import type { Tone } from "@/lib/status"

function tokenState(token: AdminToken): { tone: Tone; label: string } {
  if (token.revokedAt) return { tone: "neutral", label: "Revocado" }
  if (Date.parse(token.expiresAt) < Date.now())
    return { tone: "warn", label: "Vencido" }
  return { tone: "ok", label: "Activo" }
}

const scopeHelp: Record<AdminTokenScope, string> = {
  "admin:read": "Todas las tools de lectura del MCP admin.",
  "admin:sql": "Además, SELECT libre sobre las vistas ops.v_* con admin_sql.",
}

function CreateTokenDialog() {
  const queryClient = useQueryClient()
  const [open, setOpen] = React.useState(false)
  const [name, setName] = React.useState("")
  const [ttl, setTtl] = React.useState("7")
  const [scopes, setScopes] = React.useState<AdminTokenScope[]>(["admin:read"])
  const [pending, setPending] = React.useState(false)
  // El token completo vive solo aquí y se descarta al cerrar. El servidor guarda sha256.
  const [created, setCreated] = React.useState<{
    token: string
    name: string
  } | null>(null)
  const valid = name.trim().length >= 3 && scopes.length > 0

  function change(next: boolean) {
    if (pending) return
    setOpen(next)
    if (!next) {
      setCreated(null)
      setName("")
      setTtl("7")
      setScopes(["admin:read"])
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!valid) return
    setPending(true)
    try {
      const result = await api("createToken", {
        body: { name: name.trim(), ttlDays: Number(ttl), scopes },
      })
      setCreated({ token: result.token, name: result.meta.name })
      void queryClient.invalidateQueries({ queryKey: ["tokens"] })
    } catch (error) {
      if (isApiError(error, "not_fresh")) {
        change(false)
        requestReauth()
      } else {
        toast.error("No se pudo crear el token.", {
          description: error instanceof Error ? error.message : undefined,
        })
      }
    } finally {
      setPending(false)
    }
  }

  const origin = typeof window === "undefined" ? "" : window.location.origin
  const command = created
    ? `claude mcp add --transport http sideband-admin "${origin}/mcp" --header "Authorization: Bearer ${created.token}"`
    : ""

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogTrigger asChild>
        <Button size="sm">
          <PlusIcon data-icon="inline-start" />
          Crear token
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        {created ? (
          <>
            <DialogHeader>
              <DialogTitle>Token creado</DialogTitle>
              <DialogDescription>
                «{created.name}» está listo. Cópialo ahora:{" "}
                <span className="font-medium text-foreground">
                  no se volverá a mostrar
                </span>
                .
              </DialogDescription>
            </DialogHeader>
            <div className="flex min-w-0 flex-col gap-4">
              <InputGroup className="h-9">
                <InputGroupAddon>
                  <KeyRoundIcon />
                </InputGroupAddon>
                <InputGroupInput
                  readOnly
                  value={created.token}
                  aria-label="Token"
                  className="font-mono text-xs"
                  onFocus={(e) => e.currentTarget.select()}
                />
                <InputGroupAddon align="inline-end">
                  <CopyButton value={created.token} label="Copiar token" />
                </InputGroupAddon>
              </InputGroup>
              <div className="flex min-w-0 flex-col gap-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">
                    Conectar Claude Code
                  </span>
                  <CopyButton value={command} label="Copiar comando" />
                </div>
                <pre className="overflow-x-auto rounded-lg border bg-muted/40 p-3 font-mono text-[11px] leading-relaxed break-all whitespace-pre-wrap">
                  {command}
                </pre>
              </div>
              <Alert>
                <TriangleAlertIcon />
                <AlertTitle>Guárdalo como un secreto</AlertTitle>
                <AlertDescription>
                  Solo sirve en /mcp, nunca revela payloads ni ejecuta acciones.
                  Revócalo aquí si se filtra.
                </AlertDescription>
              </Alert>
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button>Listo, ya lo copié</Button>
              </DialogClose>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-6">
            <DialogHeader>
              <DialogTitle>Crear token MCP</DialogTitle>
              <DialogDescription>
                Token personal sba_ para conectar Claude Code o Codex al MCP de
                administración.
              </DialogDescription>
            </DialogHeader>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="token-name">Nombre</FieldLabel>
                <Input
                  id="token-name"
                  placeholder="Claude Code · laptop"
                  value={name}
                  maxLength={60}
                  onChange={(e) => setName(e.target.value)}
                  autoFocus
                />
                <FieldDescription>
                  Para reconocerlo en la auditoría. Entre 3 y 60 caracteres.
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel id="token-ttl">Duración</FieldLabel>
                <ToggleGroup
                  type="single"
                  variant="outline"
                  size="sm"
                  spacing={0}
                  value={ttl}
                  onValueChange={(v) => v && setTtl(v)}
                  aria-labelledby="token-ttl"
                >
                  {["1", "7", "14", "30"].map((d) => (
                    <ToggleGroupItem key={d} value={d}>
                      {d} {d === "1" ? "día" : "días"}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </Field>
              <FieldSet>
                <FieldLegend variant="label">Permisos</FieldLegend>
                <FieldGroup className="gap-3">
                  {AdminTokenScope.options.map((scope) => (
                    <Field key={scope} orientation="horizontal">
                      <Checkbox
                        id={`scope-${scope}`}
                        checked={scopes.includes(scope)}
                        onCheckedChange={(checked) =>
                          setScopes((prev) =>
                            checked
                              ? [...prev, scope]
                              : prev.filter((s) => s !== scope)
                          )
                        }
                      />
                      <div className="flex flex-col gap-0.5">
                        <FieldLabel
                          htmlFor={`scope-${scope}`}
                          className="font-mono text-xs font-normal"
                        >
                          {scope}
                        </FieldLabel>
                        <FieldDescription className="text-xs">
                          {scopeHelp[scope]}
                        </FieldDescription>
                      </div>
                    </Field>
                  ))}
                </FieldGroup>
              </FieldSet>
            </FieldGroup>
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline" disabled={pending}>
                  Cancelar
                </Button>
              </DialogClose>
              <Button type="submit" disabled={!valid || pending}>
                {pending ? <Spinner data-icon="inline-start" /> : null}
                Crear token
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

function RevokeTokenDialog({
  token,
  onClose,
}: {
  token: AdminToken | null
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const revoke = useMutation({
    mutationFn: (id: string) => api("revokeToken", { params: { id } }),
    onSuccess: () => {
      toast.success("Token revocado")
      void queryClient.invalidateQueries({ queryKey: ["tokens"] })
      onClose()
    },
    onError: (error) =>
      toast.error("No se pudo revocar.", { description: error.message }),
  })
  return (
    <AlertDialog
      open={token !== null}
      onOpenChange={(open) => !open && !revoke.isPending && onClose()}
    >
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogMedia>
            <TrashIcon />
          </AlertDialogMedia>
          <AlertDialogTitle>Revocar token</AlertDialogTitle>
          <AlertDialogDescription>
            «{token?.name}» (<span className="font-mono">{token?.prefix}…</span>
            ) deja de funcionar en el siguiente request.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={revoke.isPending}>
            Cancelar
          </AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={revoke.isPending}
            onClick={(event) => {
              event.preventDefault()
              if (token) revoke.mutate(token.id)
            }}
          >
            {revoke.isPending ? <Spinner data-icon="inline-start" /> : null}
            Revocar
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export function TokensPage() {
  const { isOperator } = useSession()
  const [revoking, setRevoking] = React.useState<AdminToken | null>(null)
  const query = useQuery({
    queryKey: ["tokens"],
    queryFn: ({ signal }) => api("tokens", undefined, { signal }),
    enabled: isOperator,
  })

  const columns = React.useMemo<ColumnDef<AdminToken, unknown>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Nombre",
        cell: ({ row }) => (
          <span className="flex min-w-0 flex-col">
            <span className="truncate font-medium">{row.original.name}</span>
            <span className="font-mono text-xs text-muted-foreground">
              {row.original.prefix}…
            </span>
          </span>
        ),
      },
      {
        id: "state",
        header: "Estado",
        accessorFn: (t) => tokenState(t).label,
        cell: ({ row }) => {
          const s = tokenState(row.original)
          return <ToneBadge tone={s.tone}>{s.label}</ToneBadge>
        },
      },
      {
        accessorKey: "scopes",
        header: "Permisos",
        enableSorting: false,
        cell: ({ row }) => (
          <span className="flex gap-1">
            {row.original.scopes.map((s) => (
              <Badge
                key={s}
                variant="secondary"
                className="font-mono text-[11px]"
              >
                {s}
              </Badge>
            ))}
          </span>
        ),
      },
      {
        accessorKey: "createdBy",
        header: "Creado por",
        meta: { className: "hidden lg:table-cell" },
        cell: ({ row }) => (
          <span className="text-muted-foreground">
            {row.original.createdBy}
          </span>
        ),
      },
      {
        accessorKey: "lastUsedAt",
        header: "Último uso",
        cell: ({ row }) =>
          row.original.lastUsedAt ? (
            <RelativeTime
              value={row.original.lastUsedAt}
              className="text-muted-foreground"
            />
          ) : (
            <Muted>Nunca</Muted>
          ),
      },
      {
        accessorKey: "expiresAt",
        header: "Vence",
        meta: { className: "hidden md:table-cell" },
        cell: ({ row }) => (
          <RelativeTime
            value={row.original.expiresAt}
            className="text-muted-foreground"
          />
        ),
      },
      {
        id: "actions",
        header: () => <span className="sr-only">Acciones</span>,
        enableSorting: false,
        meta: { className: "w-10 text-right" },
        cell: ({ row }) =>
          row.original.revokedAt ? null : (
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={`Revocar ${row.original.name}`}
              onClick={() => setRevoking(row.original)}
            >
              <TrashIcon />
            </Button>
          ),
      },
    ],
    []
  )

  if (!isOperator) {
    return (
      <Page>
        <PageHeader title="Tokens MCP" />
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <LockIcon />
            </EmptyMedia>
            <EmptyTitle>Solo operadores</EmptyTitle>
            <EmptyDescription>
              Crear y revocar tokens del MCP admin exige rol operator.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </Page>
    )
  }

  return (
    <Page>
      <PageHeader
        title="Tokens MCP"
        description="Tokens personales sba_ para que Claude Code o Codex consulten el MCP de administración. Solo lectura y auditados."
        actions={<CreateTokenDialog />}
      />
      {query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : null}
      <Panel>
        <DataTable
          columns={columns}
          data={query.data?.items}
          loading={query.isPending}
          getRowId={(t) => t.id}
          rowClassName={(row) =>
            row.original.revokedAt ? "opacity-60" : undefined
          }
          empty={{
            title: "Sin tokens",
            description: "Crea uno para conectar un agente al MCP admin.",
          }}
        />
      </Panel>
      <RevokeTokenDialog token={revoking} onClose={() => setRevoking(null)} />
    </Page>
  )
}
