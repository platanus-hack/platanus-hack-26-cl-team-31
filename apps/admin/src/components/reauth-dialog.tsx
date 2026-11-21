import { toast } from "sonner"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { AuthButtons } from "@/components/auth-buttons"
import { refreshSession } from "@/lib/session"

// Las acciones sensibles exigen una sesión iniciada hace poco (ADMIN_FRESH_SECONDS).
export function ReauthDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Confirma tu identidad</DialogTitle>
          <DialogDescription>
            Esta acción exige una sesión iniciada hace menos de 10 minutos.
            Vuelve a entrar y repítela.
          </DialogDescription>
        </DialogHeader>
        <AuthButtons
          onSuccess={async () => {
            await refreshSession()
            onOpenChange(false)
            toast.success("Sesión renovada. Repite la acción.")
          }}
        />
      </DialogContent>
    </Dialog>
  )
}
