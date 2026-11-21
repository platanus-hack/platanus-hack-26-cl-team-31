import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import { useNavigate, useParams } from "react-router"
import type { AgentRow } from "@shared/contract"

import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { initials } from "@/lib/format"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { agentColumns } from "@/components/agent-columns"
import { CopyButton, CopyId } from "@/components/copy-id"
import { DataTable } from "@/components/data-table"
import {
  QueryError,
  KeyValues,
  Muted,
  Page,
  PageHeader,
  Panel,
} from "@/components/page"
import { RelativeTime } from "@/components/relative-time"
import { requestColumns } from "@/components/request-columns"
import { RevokeAgentDialog } from "@/components/revoke-agent-dialog"
import { userQuery } from "@/lib/queries"
import { useSession } from "@/lib/session"

export function UserDetailPage() {
  const { id = "" } = useParams()
  const navigate = useNavigate()
  const { isOperator } = useSession()
  const [revoking, setRevoking] = React.useState<AgentRow | null>(null)
  const query = useQuery(userQuery(id))
  const user = query.data
  const columns = React.useMemo(
    () =>
      agentColumns({
        showUser: false,
        onRevoke: isOperator ? setRevoking : undefined,
      }),
    [isOperator]
  )

  if (query.isError) {
    return (
      <Page>
        <PageHeader title={<span className="font-mono">{id}</span>} />
        <QueryError query={query} />
      </Page>
    )
  }
  if (!user) {
    return (
      <Page>
        <Skeleton className="h-12 w-72" />
        <Skeleton className="h-32" />
        <Skeleton className="h-64" />
      </Page>
    )
  }

  const s = user.summary
  const rules = user.rules === null ? null : JSON.stringify(user.rules, null, 2)
  return (
    <Page>
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            <Avatar className="size-9">
              <AvatarFallback>
                {initials(s.displayName ?? s.address ?? s.userId)}
              </AvatarFallback>
            </Avatar>
            <span className="flex min-w-0 flex-col">
              <span className="truncate">{s.displayName ?? "Sin nombre"}</span>
              <span className="truncate font-mono text-xs font-normal text-muted-foreground">
                {s.address ?? "sin dirección"}
              </span>
            </span>
          </span>
        }
      />
      <div className="grid gap-3 lg:grid-cols-3">
        <Card size="sm" className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Identidad</CardTitle>
            <CardDescription className="text-xs">
              Cuenta de Sideband y sesiones de Better Auth (sin tokens).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <KeyValues
              items={[
                { label: "Id", value: <CopyId value={s.userId} /> },
                {
                  label: "Dirección",
                  value: s.address ? (
                    <CopyId value={s.address} max={28} />
                  ) : (
                    <Muted />
                  ),
                },
                { label: "Correo", value: user.identity.email ?? <Muted /> },
                {
                  label: "Sesiones activas",
                  value: (
                    <span className="font-mono text-xs">
                      {user.identity.activeSessions}
                    </span>
                  ),
                },
                { label: "Alta", value: <RelativeTime value={s.createdAt} /> },
                {
                  label: "Última actividad",
                  value: <RelativeTime value={s.lastActivityAt} />,
                },
                {
                  label: "Enviadas 24 h",
                  value: <span className="font-mono text-xs">{s.sent24h}</span>,
                },
                {
                  label: "Recibidas 24 h",
                  value: (
                    <span className="font-mono text-xs">{s.received24h}</span>
                  ),
                },
                {
                  label: "Agentes",
                  value: <span className="font-mono text-xs">{s.agents}</span>,
                },
              ]}
            />
          </CardContent>
        </Card>
        <Panel
          title="Clientes OAuth"
          description="Apps MCP autorizadas por la persona"
        >
          {user.identity.oauthClients.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">
              Sin clientes autorizados.
            </p>
          ) : (
            <Table className="text-[13px]">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="h-8 pl-4 text-xs font-normal text-muted-foreground">
                    Cliente
                  </TableHead>
                  <TableHead className="h-8 text-right text-xs font-normal text-muted-foreground">
                    Tokens
                  </TableHead>
                  <TableHead className="h-8 pr-4 text-right text-xs font-normal text-muted-foreground">
                    Último token
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {user.identity.oauthClients.map((c) => (
                  <TableRow key={c.clientId}>
                    <TableCell className="py-1.5 pl-4">
                      <span className="flex flex-col">
                        <span>{c.name ?? "Sin nombre"}</span>
                        <span className="font-mono text-xs text-muted-foreground">
                          {c.clientId}
                        </span>
                      </span>
                    </TableCell>
                    <TableCell className="py-1.5 text-right font-mono text-xs">
                      {c.activeTokens}
                    </TableCell>
                    <TableCell className="py-1.5 pr-4 text-right text-muted-foreground">
                      <RelativeTime value={c.lastTokenAt} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Panel>
      </div>
      <Panel title="Agentes" description="Conexiones de esta persona">
        <DataTable
          columns={columns}
          data={user.agents}
          getRowId={(a) => a.agentId}
          empty={{ title: "Sin agentes conectados" }}
          skeletonRows={2}
        />
      </Panel>
      <div className="grid gap-3">
        <Panel
          title="Solicitudes recientes"
          description="Enviadas o recibidas"
          className="min-w-0"
        >
          <DataTable
            columns={requestColumns}
            data={user.recentRequests}
            getRowId={(r) => r.id}
            onRowClick={(r) => navigate(`/solicitudes/${r.id}`)}
            empty={{ title: "Sin solicitudes recientes" }}
          />
        </Panel>
        <Panel
          title="Reglas históricas para compartir"
          description="Registro anterior a los permisos por categoría. Los permisos vigentes se administran en Contactos."
          action={
            rules ? <CopyButton value={rules} label="Copiar reglas" /> : null
          }
        >
          {rules ? (
            <pre className="max-h-96 overflow-auto p-4 font-mono text-xs leading-relaxed">
              {rules}
            </pre>
          ) : (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">
              Sin reglas históricas guardadas.
            </p>
          )}
        </Panel>
      </div>
      <RevokeAgentDialog agent={revoking} onClose={() => setRevoking(null)} />
    </Page>
  )
}
