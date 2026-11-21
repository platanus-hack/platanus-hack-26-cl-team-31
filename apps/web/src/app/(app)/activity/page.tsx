import Link from "next/link";

import { readActivity } from "./read-activity";
import { ActivityList } from "../activity-list";
import { button, Heading } from "../ui";

export default async function ActivityPage({ searchParams }: PageProps<"/activity">) {
  const { page, items, hasNext } = await readActivity((await searchParams).page);

  return (
    <div className="max-w-4xl">
      <Heading title="Actividad">Solicitudes enviadas y recibidas.</Heading>
      <ActivityList items={items} detailed />
      {(page > 1 || hasNext) && (
        <nav aria-label="Páginas de actividad" className="mt-5 flex flex-wrap items-center gap-3">
          {page > 1 && <Link className={button} href={page === 2 ? "/activity" : `/activity?page=${page - 1}`}>Anterior</Link>}
          <span className="text-sm text-muted">Página {page}</span>
          {hasNext && <Link className={button} href={`/activity?page=${page + 1}`}>Siguiente</Link>}
        </nav>
      )}
    </div>
  );
}
