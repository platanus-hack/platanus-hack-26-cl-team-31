import { LogOutIcon, ShieldAlertIcon } from "lucide-react"
import { toast } from "sonner"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { AuthButtons } from "@/components/auth-buttons"
import { BrandMark } from "@/components/brand"
import { isMock, signOut } from "@/lib/api"
import { refreshSession } from "@/lib/session"

const deniedCodes = new Set([
  "forbidden",
  "unauthorized",
  "access_denied",
  "not_allowed",
  "unable_to_create_user",
])

// forbidden: hay sesión, pero el correo no está en ADMIN_OPERATORS ni ADMIN_VIEWERS (403).
// ?error=…: el servidor redirige a /login?error=… cuando falla el callback de Google.
export function LoginPage({ forbidden }: { forbidden?: boolean }) {
  const callbackError = new URLSearchParams(window.location.search).get("error")
  const denied =
    forbidden || (callbackError !== null && deniedCodes.has(callbackError))

  async function switchAccount() {
    await signOut()
    window.history.replaceState(null, "", "/")
    await refreshSession()
  }

  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-6 bg-muted/40 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="gap-4">
          <BrandMark className="size-9" />
          <div className="flex flex-col gap-1">
            <CardTitle className="text-lg">Sideband Admin</CardTitle>
            <CardDescription>
              Observabilidad y operación de Sideband en producción.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {denied ? (
            <Alert variant="destructive">
              <ShieldAlertIcon />
              <AlertTitle>Correo no autorizado</AlertTitle>
              <AlertDescription>
                Tu cuenta no está en la lista de operadores ni de lectores del
                admin. Pide acceso o entra con otra cuenta.
              </AlertDescription>
            </Alert>
          ) : callbackError ? (
            <Alert variant="destructive">
              <ShieldAlertIcon />
              <AlertTitle>No se pudo iniciar sesión</AlertTitle>
              <AlertDescription>
                Google devolvió un error:{" "}
                <span className="font-mono">{callbackError}</span>. Inténtalo de
                nuevo.
              </AlertDescription>
            </Alert>
          ) : null}
          {forbidden ? (
            <Button
              size="lg"
              variant="outline"
              onClick={() => void switchAccount().catch(() => toast.error("No se pudo cerrar la sesión."))}
            >
              <LogOutIcon data-icon="inline-start" />
              Usar otra cuenta
            </Button>
          ) : (
            <AuthButtons onSuccess={refreshSession} />
          )}
        </CardContent>
        <CardFooter className="text-xs text-muted-foreground">
          Solo correos en ADMIN_OPERATORS o ADMIN_VIEWERS. La sesión dura 8
          horas.
        </CardFooter>
      </Card>
      {isMock ? (
        <p className="text-xs text-muted-foreground">
          Modo mock: datos simulados, sin servidor.
        </p>
      ) : null}
    </main>
  )
}
