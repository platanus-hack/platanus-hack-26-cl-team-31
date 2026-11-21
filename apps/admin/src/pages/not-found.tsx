import { CompassIcon } from "lucide-react"
import { Link } from "react-router"

import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Page } from "@/components/page"

export function NotFoundPage() {
  return (
    <Page>
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <CompassIcon />
          </EmptyMedia>
          <EmptyTitle>Página no encontrada</EmptyTitle>
          <EmptyDescription>
            Usa ⌘K para buscar una solicitud, traza, error o persona.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button variant="outline" asChild>
            <Link to="/">Volver al resumen</Link>
          </Button>
        </EmptyContent>
      </Empty>
    </Page>
  )
}
