import Link from "next/link";
import { Suspense } from "react";

import { readActivity } from "./read-activity";
import { ActivityList } from "../activity-list";
import { button, Heading, ListSkeleton } from "../ui";

async function loadActivity(page: unknown) {
  return { ...(await readActivity(page)), now: Date.now() };
}

async function ActivityPageList({ searchParams }: { searchParams: PageProps<"/activity">["searchParams"] }) {
  const { page, items, hasNext, now } = await loadActivity((await searchParams).page);
  return (
    <>
      <ActivityList items={items} detailed now={now} />
      {(page > 1 || hasNext) && (
        <nav aria-label="Páginas de actividad" className="mt-6 flex items-center justify-between gap-3">
          {page > 1 ? <Link className={button} href={page === 2 ? "/activity" : `/activity?page=${page - 1}`}>‹ Más recientes</Link> : <span />}
          <span className="text-xs text-muted">Página {page}</span>
          {hasNext ? <Link className={button} href={`/activity?page=${page + 1}`}>Anteriores ›</Link> : <span />}
        </nav>
      )}
    </>
  );
}

export default function ActivityPage({ searchParams }: PageProps<"/activity">) {
  return (
    <div>
      <Heading title="Actividad" />
      <Suspense fallback={<ListSkeleton rows={6} label="Cargando actividad" />}>
        <ActivityPageList searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
