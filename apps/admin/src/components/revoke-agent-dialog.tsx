import { useMutation, useQueryClient } from "@tanstack/react-query"
import type { AgentRow } from "@shared/contract"
import { BanIcon } from "lucide-react"

import { ReasonActionDialog } from "@/components/reason-action-dialog"
import { api } from "@/lib/api"

export function RevokeAgentDialog({
  agent,
  onClose,
}: {
  agent: AgentRow | null
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const revoke = useMutation({
    mutationFn: ({
      userId,
      agentId,
      reason,
    }: {
      userId: string
      agentId: string
      reason: string
    }) => api("revokeAgent", { params: { userId, agentId }, body: { reason } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["agents"] })
      void queryClient.invalidateQueries({ queryKey: ["user"] })
    },
  })
  return (
    <ReasonActionDialog
      open={agent !== null}
      onOpenChange={(open) => !open && onClose()}
      title="Revocar agente"
      description={
        agent ? (
          <>
            <span className="font-medium text-foreground">{agent.label}</span>{" "}
            de <span className="font-mono text-foreground">{agent.userId}</span>{" "}
            deja de recibir avisos y solicitudes. El dueño puede volver a
            conectarlo.
          </>
        ) : null
      }
      confirmLabel="Revocar"
      destructive
      icon={<BanIcon />}
      onConfirm={(reason) =>
        revoke.mutateAsync({
          userId: agent!.userId,
          agentId: agent!.agentId,
          reason,
        })
      }
      successMessage="Agente revocado"
    />
  )
}
