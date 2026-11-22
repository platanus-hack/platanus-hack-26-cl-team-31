// «Revelar payload»: el único lugar del panel donde se ve el payload real. Exige rol operator,
// sesión fresca y motivo. El resultado vive SOLO en el estado local de este diálogo: no pasa
// por TanStack Query (ni su caché de mutaciones) y se descarta al cerrar.
import * as React from "react"
import { EyeIcon, ShieldCheckIcon } from "lucide-react"
import type { PayloadReveal } from "@shared/contract"
import { toast } from "sonner"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
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
import { ScrollArea } from "@/components/ui/scroll-area"
import { Spinner } from "@/components/ui/spinner"
import { CopyButton } from "@/components/copy-id"
import { REASON_MIN, ReasonField } from "@/components/reason-action-dialog"
import { api, isApiError } from "@/lib/api"
import { formatAbsolute } from "@/lib/format"
import { requestReauth } from "@/lib/query"
import { refreshSession } from "@/lib/session"

function JsonBlock({ label, value }: { label: string; value: unknown }) {
  const text =
    value === null || value === undefined
      ? "null"
      : JSON.stringify(value, null, 2)
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{label}</span>
        <CopyButton value={text} label={`Copiar ${label}`} />
      </div>
      <pre className="max-h-48 overflow-auto rounded-lg border bg-muted/40 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap">
        {text}
      </pre>
    </div>
  )
}

export function RevealDialog({ requestId }: { requestId: string }) {
  const id = React.useId()
  const [open, setOpen] = React.useState(false)
  const [reason, setReason] = React.useState("")
  const [pending, setPending] = React.useState(false)
  const [payload, setPayload] = React.useState<PayloadReveal | null>(null)

  function close() {
    setOpen(false)
    setPayload(null)
    setReason("")
  }

  function change(next: boolean) {
    if (pending) return
    if (next) setOpen(true)
    else close()
  }

  async function reveal(event: React.FormEvent) {
    event.preventDefault()
    if (reason.trim().length < REASON_MIN) return
    setPending(true)
    try {
      setPayload(
        await api("revealPayload", {
          params: { id: requestId },
          body: { reason: reason.trim() },
        })
      )
    } catch (error) {
      if (isApiError(error, "not_fresh")) {
        close()
        requestReauth()
      } else if (isApiError(error, "unauthorized")) {
        await refreshSession()
      } else if (isApiError(error, "rate_limited")) {
        toast.error("Límite de revelaciones alcanzado (10 por hora).")
      } else {
        toast.error("No se pudo revelar el payload.", {
          description: error instanceof Error ? error.message : undefined,
        })
      }
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <EyeIcon data-icon="inline-start" />
          Revelar payload
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Revelar payload</DialogTitle>
          <DialogDescription>
            Muestra los argumentos, el propósito y la respuesta reales de{" "}
            <span className="font-mono text-foreground">{requestId}</span>.
            Queda auditado con tu correo y el motivo.
          </DialogDescription>
        </DialogHeader>
        {payload ? (
          <div className="flex min-w-0 flex-col gap-3">
            <Alert>
              <ShieldCheckIcon />
              <AlertTitle>Revelado y auditado</AlertTitle>
              <AlertDescription className="font-mono text-xs">
                {payload.auditId} · {formatAbsolute(payload.revealedAt)}
              </AlertDescription>
            </Alert>
            <ScrollArea className="max-h-[50vh]">
              <div className="flex flex-col gap-3 pr-3">
                <JsonBlock label="args" value={payload.args} />
                <JsonBlock label="purpose" value={payload.purpose} />
                <JsonBlock label="result" value={payload.result} />
              </div>
            </ScrollArea>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline">Cerrar y descartar</Button>
              </DialogClose>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={reveal} className="flex flex-col gap-4">
            <ReasonField
              id={id}
              value={reason}
              onChange={setReason}
              placeholder="Ej.: Ana reporta que el horario devuelto no coincide con su agenda"
            />
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline" disabled={pending}>
                  Cancelar
                </Button>
              </DialogClose>
              <Button
                type="submit"
                disabled={pending || reason.trim().length < REASON_MIN}
              >
                {pending ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <EyeIcon data-icon="inline-start" />
                )}
                Revelar
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
