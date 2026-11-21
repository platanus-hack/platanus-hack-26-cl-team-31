import { AlertCircleIcon, RotateCwIcon } from "lucide-react"
import type { UseQueryResult } from "@tanstack/react-query"
import { cn } from "cn"

import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { CopyButton } from "@/components/copy-id"
import { isApiError } from "@/lib/api"

export function Page({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex w-full min-w-0 flex-col gap-4 p-4 md:gap-6 md:p-6",
        className
      )}
    >
      {children}
    </div>
  )
}

export function PageHeader({
  title,
  description,
  actions,
  children,
}: {
  title: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
  children?: React.ReactNode
}) {
  return (
    <header className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="font-heading text-lg font-semibold tracking-tight">
            {title}
          </h1>
          {description ? (
            <p className="text-sm text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </div>
      {children}
    </header>
  )
}

// Contenedor de tabla o lista con título: Card compacta sin padding lateral en el contenido.
export function Panel({
  title,
  description,
  action,
  children,
  className,
  flush = true,
}: {
  title?: React.ReactNode
  description?: React.ReactNode
  action?: React.ReactNode
  children: React.ReactNode
  className?: string
  flush?: boolean
}) {
  return (
    <Card size="sm" className={cn("min-w-0 gap-0 py-0", className)}>
      {title ? (
        <CardHeader className="border-b py-3">
          <CardTitle>{title}</CardTitle>
          {description ? (
            <CardDescription className="text-xs">{description}</CardDescription>
          ) : null}
          {action ? <CardAction>{action}</CardAction> : null}
        </CardHeader>
      ) : null}
      <CardContent className={cn(flush ? "px-0" : "py-3")}>
        {children}
      </CardContent>
    </Card>
  )
}

export function QueryError({
  query,
  className,
}: {
  query: Pick<UseQueryResult, "error" | "isError" | "refetch">
  className?: string
}) {
  return query.isError ? (
    <ErrorState
      error={query.error}
      onRetry={() => void query.refetch()}
      className={className}
    />
  ) : null
}

export function ErrorState({
  error,
  onRetry,
  className,
}: {
  error: unknown
  onRetry?: () => void
  className?: string
}) {
  const message = error instanceof Error ? error.message : "Error desconocido"
  const errorId = isApiError(error) ? error.errorId : undefined
  const notFound = isApiError(error, "not_found")
  // 502 upstream: el servidor no pudo leer las vistas (p. ej. migraciones pendientes).
  const upstream = isApiError(error, "upstream")
  return (
    <Alert
      variant={notFound || upstream ? "default" : "destructive"}
      className={className}
    >
      <AlertCircleIcon />
      <AlertTitle>
        {notFound
          ? "No encontrado"
          : upstream
            ? "Datos no disponibles"
            : "No se pudo cargar"}
      </AlertTitle>
      <AlertDescription>
        <span>{message}</span>
        {errorId ? (
          <span className="inline-flex items-center gap-1 font-mono text-xs">
            errorId {errorId}
            <CopyButton value={errorId} />
          </span>
        ) : null}
      </AlertDescription>
      {onRetry && !notFound ? (
        <AlertAction>
          <Button size="xs" variant="outline" onClick={onRetry}>
            <RotateCwIcon data-icon="inline-start" />
            Reintentar
          </Button>
        </AlertAction>
      ) : null}
    </Alert>
  )
}

// Lista de pares etiqueta/valor, en dos columnas en pantallas anchas.
export function KeyValues({
  items,
  className,
}: {
  items: Array<{ label: string; value: React.ReactNode; hidden?: boolean }>
  className?: string
}) {
  return (
    <dl
      className={cn(
        "grid grid-cols-2 gap-x-6 gap-y-3 text-sm lg:grid-cols-3",
        className
      )}
    >
      {items
        .filter((item) => !item.hidden)
        .map((item) => (
          <div key={item.label} className="flex min-w-0 flex-col gap-0.5">
            <dt className="text-xs text-muted-foreground">{item.label}</dt>
            <dd className="min-w-0 truncate">{item.value}</dd>
          </div>
        ))}
    </dl>
  )
}

export function Mono({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return <span className={cn("font-mono text-xs", className)}>{children}</span>
}

export function Muted({ children }: { children?: React.ReactNode }) {
  return <span className="text-muted-foreground">{children ?? "—"}</span>
}
