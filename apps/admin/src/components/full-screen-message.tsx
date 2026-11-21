import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Spinner } from "@/components/ui/spinner"
import { BrandMark } from "@/components/brand"

export function FullScreenMessage({
  title,
  description,
  loading,
  action,
}: {
  title: string
  description?: string
  loading?: boolean
  action?: { label: string; onClick: () => void }
}) {
  return (
    <main className="flex min-h-svh items-center justify-center p-4">
      <Empty>
        <EmptyHeader>
          <EmptyMedia>{loading ? <Spinner /> : <BrandMark />}</EmptyMedia>
          <EmptyTitle>{title}</EmptyTitle>
          {description ? (
            <EmptyDescription>{description}</EmptyDescription>
          ) : null}
        </EmptyHeader>
        {action ? (
          <EmptyContent>
            <Button variant="outline" onClick={action.onClick}>
              {action.label}
            </Button>
          </EmptyContent>
        ) : null}
      </Empty>
    </main>
  )
}
