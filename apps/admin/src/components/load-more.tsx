import type { UseInfiniteQueryResult } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"

type Pagination = Pick<
  UseInfiniteQueryResult,
  "hasNextPage" | "isFetchingNextPage" | "fetchNextPage"
>

export function LoadMore({ query }: { query: Pagination }) {
  if (!query.hasNextPage) return null
  return (
    <div className="flex justify-center border-t p-2">
      <Button
        variant="ghost"
        size="sm"
        disabled={query.isFetchingNextPage}
        onClick={() => void query.fetchNextPage()}
      >
        {query.isFetchingNextPage ? <Spinner data-icon="inline-start" /> : null}
        Cargar más
      </Button>
    </div>
  )
}
