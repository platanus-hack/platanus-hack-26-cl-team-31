import type { TelemetryEvent } from "@shared/contract"
import { BugIcon, InboxIcon, WaypointsIcon } from "lucide-react"
import { Link } from "react-router"

import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { eventReferences } from "@/components/event-references"
import { CopyButton, CopyId } from "@/components/copy-id"
import { KeyValues, Muted } from "@/components/page"
import { LevelBadge } from "@/components/status"
import { formatAbsolute, formatDuration } from "@/lib/format"
import { serviceLabel } from "@/lib/status"

export function EventSheet({
  event,
  onOpenChange,
}: {
  event: TelemetryEvent | null
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Sheet open={event !== null} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 sm:max-w-lg">
        {event ? (
          <>
            <SheetHeader className="border-b">
              <SheetTitle className="flex items-center gap-2 font-mono text-sm">
                {event.name}
                <LevelBadge level={event.level} />
              </SheetTitle>
              <SheetDescription className="text-xs">
                {serviceLabel[event.service]} · {event.kind} ·{" "}
                {formatAbsolute(event.at)}
              </SheetDescription>
            </SheetHeader>
            <div className="flex flex-col gap-4 overflow-y-auto p-4">
              <KeyValues
                className="lg:grid-cols-2"
                items={[
                  { label: "Evento", value: <CopyId value={event.id} /> },
                  {
                    label: "Duración",
                    value: (
                      <span className="font-mono text-xs">
                        {formatDuration(event.durationMs)}
                      </span>
                    ),
                  },
                  {
                    label: "Status",
                    value: (
                      <span className="font-mono text-xs">
                        {event.status ?? "—"}
                      </span>
                    ),
                  },
                  ...eventReferences(event, { includeSpan: true }),
                  {
                    label: "Error",
                    value: event.errorId ? (
                      <CopyId
                        value={event.errorId}
                        to={`/errores/${event.errorId}`}
                        max={16}
                      />
                    ) : (
                      <Muted />
                    ),
                  },
                ]}
              />
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">attrs</span>
                  <CopyButton
                    value={JSON.stringify(event.attrs, null, 2)}
                    label="Copiar attrs"
                  />
                </div>
                <pre className="overflow-auto rounded-lg border bg-muted/40 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap">
                  {JSON.stringify(event.attrs, null, 2)}
                </pre>
              </div>
            </div>
            <SheetFooter className="flex-row flex-wrap border-t">
              {event.traceId ? (
                <Button variant="outline" size="sm" asChild>
                  <Link to={`/trazas/${event.traceId}`}>
                    <WaypointsIcon data-icon="inline-start" />
                    Traza
                  </Link>
                </Button>
              ) : null}
              {event.requestId ? (
                <Button variant="outline" size="sm" asChild>
                  <Link to={`/solicitudes/${event.requestId}`}>
                    <InboxIcon data-icon="inline-start" />
                    Solicitud
                  </Link>
                </Button>
              ) : null}
              {event.errorId ? (
                <Button variant="outline" size="sm" asChild>
                  <Link to={`/errores/${event.errorId}`}>
                    <BugIcon data-icon="inline-start" />
                    Error
                  </Link>
                </Button>
              ) : null}
            </SheetFooter>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}
