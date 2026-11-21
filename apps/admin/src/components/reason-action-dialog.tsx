// Confirmación de una acción de operador (reintentar, expirar, revocar…). Todas exigen un
// motivo de 10 a 500 caracteres que queda en admin.audit (docs/admin.md §4).
import * as React from "react"
import { toast } from "sonner"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { isApiError } from "@/lib/api"

export const REASON_MIN = 10
export const REASON_MAX = 500

export function ReasonField({
  id,
  value,
  onChange,
  placeholder,
}: {
  id: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
}) {
  const length = value.trim().length
  const invalid = value.length > 0 && length < REASON_MIN
  return (
    <Field data-invalid={invalid || undefined}>
      <FieldLabel htmlFor={id}>Motivo</FieldLabel>
      <Textarea
        id={id}
        value={value}
        maxLength={REASON_MAX}
        placeholder={placeholder ?? "Por qué lo haces. Queda en la auditoría."}
        aria-invalid={invalid || undefined}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-20"
      />
      <FieldDescription className="flex justify-between gap-2 text-xs">
        <span>
          Mínimo {REASON_MIN} caracteres. Queda registrado con tu correo.
        </span>
        <span className="tabular-nums">
          {length}/{REASON_MAX}
        </span>
      </FieldDescription>
    </Field>
  )
}

export function ReasonActionDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  destructive,
  icon,
  onConfirm,
  successMessage,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: React.ReactNode
  confirmLabel: string
  destructive?: boolean
  icon?: React.ReactNode
  onConfirm: (reason: string) => Promise<unknown>
  successMessage: string
}) {
  const id = React.useId()
  const [reason, setReason] = React.useState("")
  const [pending, setPending] = React.useState(false)
  const valid = reason.trim().length >= REASON_MIN

  function change(next: boolean) {
    if (pending) return
    if (!next) setReason("")
    onOpenChange(next)
  }

  async function confirm(event: React.MouseEvent) {
    event.preventDefault()
    if (!valid) return
    setPending(true)
    try {
      await onConfirm(reason.trim())
      toast.success(successMessage)
      setReason("")
      onOpenChange(false)
    } catch (error) {
      // not_fresh y unauthorized los maneja el MutationCache/QueryClient global.
      if (
        !isApiError(error, "not_fresh") &&
        !isApiError(error, "unauthorized")
      ) {
        toast.error("La acción falló.", {
          description: error instanceof Error ? error.message : undefined,
        })
      } else {
        onOpenChange(false)
      }
    } finally {
      setPending(false)
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={change}>
      <AlertDialogContent>
        <AlertDialogHeader>
          {icon ? <AlertDialogMedia>{icon}</AlertDialogMedia> : null}
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <ReasonField id={id} value={reason} onChange={setReason} />
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            variant={destructive ? "destructive" : "default"}
            disabled={!valid || pending}
            onClick={confirm}
          >
            {pending ? <Spinner data-icon="inline-start" /> : null}
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
