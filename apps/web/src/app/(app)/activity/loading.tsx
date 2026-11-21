import { ListSkeleton, Skeleton } from "../ui";

export default function Loading() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-3 w-12" />
      <ListSkeleton rows={6} label="Cargando actividad" />
    </div>
  );
}
