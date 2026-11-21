import { useQuery } from "@tanstack/react-query"

import { api } from "@/lib/api"
import { traceQuery } from "@/lib/queries"
import { layoutTrace, recentTraces } from "./model"

export function useTraceLayout(id: string) {
  return useQuery({ ...traceQuery(id), select: layoutTrace })
}

export function useRecentTraces() {
  return useQuery({
    queryKey: ["events", { recentTraces: true }],
    queryFn: ({ signal }) =>
      api("events", { query: { limit: 300 } }, { signal }),
    staleTime: 15_000,
    select: recentTraces,
  })
}
