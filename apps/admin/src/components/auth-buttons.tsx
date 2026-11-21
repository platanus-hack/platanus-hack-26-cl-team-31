import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import { TerminalIcon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { GoogleIcon } from "@/components/brand"
import {
  devLogin,
  isApiError,
  isMock,
  probeDevLogin,
  signInWithGoogle,
} from "@/lib/api"

// Botones de entrada: Google (Better Auth del admin) y, si el servidor lo permite, dev login.
// El botón dev se muestra siempre en modo mock y, con servidor real, solo si
// GET /api/admin/dev-login responde {enabled:true} (404 = deshabilitado).
export function AuthButtons({
  onSuccess,
}: {
  onSuccess: () => Promise<void> | void
}) {
  const [pending, setPending] = React.useState<"google" | "dev" | null>(null)
  const [devHidden, setDevHidden] = React.useState(false)
  const probe = useQuery({
    queryKey: ["dev-login-probe"],
    queryFn: probeDevLogin,
    staleTime: 60_000,
  })
  const showDev = !devHidden && (isMock || probe.data === true)

  async function google() {
    setPending("google")
    try {
      await signInWithGoogle()
      if (isMock) await onSuccess()
    } catch (error) {
      toast.error("No se pudo iniciar sesión con Google.", {
        description: error instanceof Error ? error.message : undefined,
      })
    } finally {
      setPending(null)
    }
  }

  async function dev() {
    setPending("dev")
    try {
      await devLogin()
      await onSuccess()
    } catch (error) {
      if (isApiError(error, "not_found")) {
        setDevHidden(true)
        toast.error("El dev login no está habilitado (ADMIN_DEV_AUTH).")
      } else {
        toast.error("No se pudo entrar como dev.", {
          description: error instanceof Error ? error.message : undefined,
        })
      }
    } finally {
      setPending(null)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Button size="lg" onClick={google} disabled={pending !== null}>
        {pending === "google" ? (
          <Spinner data-icon="inline-start" />
        ) : (
          <GoogleIcon data-icon="inline-start" />
        )}
        Entrar con Google
      </Button>
      {showDev ? (
        <Button
          size="lg"
          variant="outline"
          onClick={dev}
          disabled={pending !== null}
        >
          {pending === "dev" ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <TerminalIcon data-icon="inline-start" />
          )}
          Entrar como dev
        </Button>
      ) : null}
    </div>
  )
}
