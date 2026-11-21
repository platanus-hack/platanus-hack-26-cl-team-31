// Data table de shadcn sobre TanStack Table: denso, con orden por columna, filas
// navegables con teclado y esqueleto mientras carga.
import * as React from "react"
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type Row,
  type SortingState,
} from "@tanstack/react-table"
import { ArrowDownIcon, ArrowUpIcon, InboxIcon } from "lucide-react"
import { cn } from "cn"

import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

declare module "@tanstack/react-table" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData, TValue> {
    className?: string
  }
}

const EMPTY_ROWS: never[] = []

export function DataTable<TData>({
  columns,
  data,
  loading,
  onRowClick,
  rowClassName,
  empty = {
    title: "Sin resultados",
    description: "No hay filas para mostrar con estos filtros.",
  },
  initialSorting = [],
  skeletonRows = 8,
  getRowId,
}: {
  columns: ColumnDef<TData, unknown>[]
  data: TData[] | undefined
  loading?: boolean
  onRowClick?: (row: TData) => void
  rowClassName?: (row: Row<TData>) => string | undefined
  empty?: { title: string; description?: string }
  initialSorting?: SortingState
  skeletonRows?: number
  getRowId?: (row: TData, index: number) => string
}) {
  const [sorting, setSorting] = React.useState<SortingState>(initialSorting)
  const table = useReactTable({
    data: data ?? EMPTY_ROWS,
    autoResetPageIndex: false,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getRowId,
  })

  const showSkeleton = loading && !data
  const rows = table.getRowModel().rows

  return (
    <Table className="text-[13px]">
      <TableHeader>
        {table.getHeaderGroups().map((group) => (
          <TableRow key={group.id} className="hover:bg-transparent">
            {group.headers.map((header) => {
              const sortable =
                header.column.getCanSort() &&
                header.column.columnDef.enableSorting !== false
              const sorted = header.column.getIsSorted()
              return (
                <TableHead
                  key={header.id}
                  className={cn(
                    "h-8 text-xs font-normal text-muted-foreground",
                    header.column.columnDef.meta?.className
                  )}
                >
                  {header.isPlaceholder ? null : sortable ? (
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 hover:text-foreground"
                      onClick={header.column.getToggleSortingHandler()}
                    >
                      {flexRender(
                        header.column.columnDef.header,
                        header.getContext()
                      )}
                      {sorted === "asc" ? (
                        <ArrowUpIcon className="size-3" />
                      ) : sorted === "desc" ? (
                        <ArrowDownIcon className="size-3" />
                      ) : null}
                    </button>
                  ) : (
                    flexRender(
                      header.column.columnDef.header,
                      header.getContext()
                    )
                  )}
                </TableHead>
              )
            })}
          </TableRow>
        ))}
      </TableHeader>
      <TableBody>
        {showSkeleton
          ? Array.from({ length: skeletonRows }, (_, i) => (
              <TableRow key={i} className="hover:bg-transparent">
                {columns.map((_, j) => (
                  <TableCell key={j} className="py-2">
                    <Skeleton className="h-4 w-full max-w-32" />
                  </TableCell>
                ))}
              </TableRow>
            ))
          : null}
        {!showSkeleton && rows.length === 0 ? (
          <TableRow className="hover:bg-transparent">
            <TableCell colSpan={columns.length} className="p-0">
              <Empty className="py-10">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <InboxIcon />
                  </EmptyMedia>
                  <EmptyTitle>{empty.title}</EmptyTitle>
                  {empty.description ? (
                    <EmptyDescription>{empty.description}</EmptyDescription>
                  ) : null}
                </EmptyHeader>
              </Empty>
            </TableCell>
          </TableRow>
        ) : null}
        {rows.map((row) => (
          <TableRow
            key={row.id}
            tabIndex={onRowClick ? 0 : undefined}
            className={cn(
              onRowClick &&
                "cursor-pointer focus-visible:bg-muted/60 focus-visible:outline-none",
              rowClassName?.(row)
            )}
            onClick={onRowClick ? () => onRowClick(row.original) : undefined}
            onKeyDown={
              onRowClick
                ? (event) => {
                    if (event.key === "Enter") onRowClick(row.original)
                  }
                : undefined
            }
          >
            {row.getVisibleCells().map((cell) => (
              <TableCell
                key={cell.id}
                className={cn("py-1.5", cell.column.columnDef.meta?.className)}
              >
                {flexRender(cell.column.columnDef.cell, cell.getContext())}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
