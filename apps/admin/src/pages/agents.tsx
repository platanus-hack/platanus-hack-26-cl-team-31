import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import type { AgentRow } from "@shared/contract"
import { WakeKind } from "@team-31/protocol"

import { Field, FieldLabel } from "@/components/ui/field"
import { Switch } from "@/components/ui/switch"
import { agentColumns, agentHealth } from "@/components/agent-columns"
import { DataTable } from "@/components/data-table"
import { FilterBar, SelectFilter } from "@/components/filters"
import { ErrorState, Page, PageHeader, Panel } from "@/components/page"
import { RevokeAgentDialog } from "@/components/revoke-agent-dialog"
import { ToneBadge } from "@/components/status"
import { api } from "@/lib/api"
import { wakeKindLabel } from "@/lib/status"
import { useSession } from "@/lib/session"

export function AgentsPage() {
  const { isOperator } = useSession()
  const [failing, setFailing] = React.useState(false)
  const [kind, setKind] = React.useState<WakeKind | undefined>()
  const [revoking, setRevoking] = React.useState<AgentRow | null>(null)
  const query = useQuery({
    queryKey: ["agents", { failing, kind }],
    queryFn: ({ signal }) =>
      api(
        "agents",
        { query: { failing: failing || undefined, kind } },
        { signal }
      ),
    placeholderData: (previous) => previous,
  })
  const columns = React.useMemo(
    () => agentColumns({ onRevoke: isOperator ? setRevoking : undefined }),
    [isOperator]
  )
  const failingCount =
    query.data?.items.filter((a) => agentHealth(a).tone === "error").length ?? 0

  return (
    <Page>
      <PageHeader
        title="Agentes"
        description="Conexiones de agentes y la salud de sus avisos. Solo se muestra el host del destino, nunca la URL ni el secreto."
        actions={
          failingCount ? (
            <ToneBadge tone="error">{failingCount} fallando</ToneBadge>
          ) : null
        }
      />
      <FilterBar>
        <SelectFilter
          label="Adaptador"
          allLabel="Todos los adaptadores"
          options={WakeKind.options}
          value={kind}
          onChange={setKind}
          renderOption={(k) => wakeKindLabel[k]}
        />
        <Field orientation="horizontal" className="w-auto">
          <Switch id="failing" checked={failing} onCheckedChange={setFailing} />
          <FieldLabel htmlFor="failing" className="font-normal">
            Solo con avisos fallando
          </FieldLabel>
        </Field>
      </FilterBar>
      {query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : null}
      <Panel>
        <DataTable
          columns={columns}
          data={query.data?.items}
          loading={query.isPending}
          getRowId={(a) => `${a.userId}/${a.agentId}`}
          empty={{
            title: "Sin agentes",
            description: failing
              ? "Ningún agente con avisos fallando."
              : undefined,
          }}
        />
      </Panel>
      <RevokeAgentDialog agent={revoking} onClose={() => setRevoking(null)} />
    </Page>
  )
}
