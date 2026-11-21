import * as React from "react"
import { CheckIcon, CopyIcon } from "lucide-react"
import { Link } from "react-router"
import { toast } from "sonner"
import { cn } from "cn"

import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

export async function copyText(value: string, label = "Copiado") {
  try {
    await navigator.clipboard.writeText(value)
    toast.success(label, {
      description: value.length > 48 ? `${value.slice(0, 48)}…` : value,
    })
    return true
  } catch {
    toast.error("No se pudo copiar al portapapeles.")
    return false
  }
}

export function CopyButton({
  value,
  label = "Copiar",
  className,
}: {
  value: string
  label?: string
  className?: string
}) {
  const [copied, setCopied] = React.useState(false)
  React.useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1_500)
    return () => clearTimeout(timer)
  }, [copied])
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      className={cn("text-muted-foreground", className)}
      aria-label={label}
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        void copyText(value).then(setCopied)
      }}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </Button>
  )
}

function shorten(value: string, max: number) {
  if (value.length <= max) return value
  return `${value.slice(0, max - 1)}…`
}

// Id en monoespaciada, opcionalmente con enlace, siempre con botón copiar.
export function CopyId({
  value,
  to,
  max = 14,
  className,
}: {
  value: string
  to?: string
  max?: number
  className?: string
}) {
  const text = shorten(value, max)
  const truncated = text !== value
  const content = to ? (
    <Link
      to={to}
      className="truncate underline-offset-4 hover:underline"
      onClick={(e) => e.stopPropagation()}
    >
      {text}
    </Link>
  ) : (
    <span className="truncate">{text}</span>
  )
  return (
    <span
      className={cn(
        "inline-flex max-w-full min-w-0 items-center gap-0.5 font-mono text-xs",
        className
      )}
    >
      {truncated ? (
        <Tooltip>
          <TooltipTrigger asChild>{content}</TooltipTrigger>
          <TooltipContent className="font-mono">{value}</TooltipContent>
        </Tooltip>
      ) : (
        content
      )}
      <CopyButton
        value={value}
        label={`Copiar ${value}`}
        className="opacity-60 hover:opacity-100"
      />
    </span>
  )
}
