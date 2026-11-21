// Opciones de consulta compartidas (claves estables entre páginas, sidebar y ⌘K).
import { queryOptions } from "@tanstack/react-query"
import { useMemo } from "react"
import type { Window } from "@shared/contract"

import { api } from "@/lib/api"

export const cursorPagination = {
  initialPageParam: undefined as string | undefined,
  getNextPageParam: (last: { nextCursor: string | null }) =>
    last.nextCursor ?? undefined,
}

export function usePageItems<T>(data: { pages: { items: T[] }[] } | undefined) {
  return useMemo(() => data?.pages.flatMap((page) => page.items), [data])
}

export const overviewQuery = (window: Window) =>
  queryOptions({
    queryKey: ["overview", window],
    queryFn: ({ signal }) => api("overview", { query: { window } }, { signal }),
    refetchInterval: 15_000,
    staleTime: 5_000,
  })

export const requestQuery = (id: string) =>
  queryOptions({
    queryKey: ["request", id],
    queryFn: ({ signal }) => api("request", { params: { id } }, { signal }),
  })

export const traceQuery = (id: string) =>
  queryOptions({
    queryKey: ["trace", id],
    queryFn: ({ signal }) => api("trace", { params: { id } }, { signal }),
    staleTime: 60_000,
  })

export const errorQuery = (id: string) =>
  queryOptions({
    queryKey: ["error", id],
    queryFn: ({ signal }) => api("error", { params: { id } }, { signal }),
    staleTime: 60_000,
  })

export const userQuery = (id: string) =>
  queryOptions({
    queryKey: ["user", id],
    queryFn: ({ signal }) => api("user", { params: { id } }, { signal }),
  })
