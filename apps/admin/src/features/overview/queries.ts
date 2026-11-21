import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import type { Overview, Window } from "@shared/contract"

import { api } from "@/lib/api"
import { overviewQuery } from "@/lib/queries"
import { windowMs } from "@/lib/window"
import { bucketize } from "./request-history"

function summarizeOverview(data: Overview) {
  const wakeTotals = data.wakes.reduce(
    (acc, w) => ({
      ok: acc.ok + w.ok,
      failed: acc.failed + w.failed,
      retried: acc.retried + w.retried,
    }),
    { ok: 0, failed: 0, retried: 0 }
  )
  const attempts = wakeTotals.ok + wakeTotals.failed
  const okRatio = attempts ? wakeTotals.ok / attempts : null
  return { ...data, wakeTotals, okRatio }
}

export type OverviewSummary = ReturnType<typeof summarizeOverview>

export function useOverviewSummary(window: Window) {
  return useQuery({ ...overviewQuery(window), select: summarizeOverview })
}

export function useStuckRequests() {
  return useQuery({
    queryKey: ["requests", { stuck: true, limit: 8 }],
    queryFn: ({ signal }) =>
      api("requests", { query: { stuck: true, limit: 8 } }, { signal }),
    select: (page) => page.items,
    refetchInterval: 15_000,
  })
}

export function useRequestHistory(window: Window) {
  const [mountedAt] = React.useState(() => Date.now())
  const query = useQuery({
    queryKey: ["overview-requests", window],
    queryFn: ({ signal }) =>
      api(
        "requests",
        {
          query: {
            since: new Date(Date.now() - windowMs[window]).toISOString(),
            limit: 200,
          },
        },
        { signal }
      ),
    refetchInterval: 15_000,
  })
  const buckets = React.useMemo(
    () =>
      bucketize(query.data?.items ?? [], window, query.dataUpdatedAt || mountedAt),
    [query.data, query.dataUpdatedAt, window, mountedAt]
  )
  return { query, buckets }
}
