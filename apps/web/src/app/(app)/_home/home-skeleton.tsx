import { card, ListSkeleton, Skeleton } from "../ui";

export function HomeSkeleton() {
  return (
    <div>
      <div className="mb-8 space-y-3 lg:pt-2">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="mb-10 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className={`${card} space-y-3 p-5`}>
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="h-8 w-10" />
            <Skeleton className="h-3 w-20" />
          </div>
        ))}
      </div>
      <div className="grid items-start gap-10 lg:grid-cols-[1.6fr_1fr]">
        <div className="space-y-3">
          <Skeleton className="h-4 w-28" />
          <div className={`${card} space-y-5 p-6`}>
            <div className="flex items-center gap-3"><Skeleton className="size-9 rounded-full" /><Skeleton className="h-3.5 w-40" /></div>
            <Skeleton className="h-6 w-3/4" />
            <Skeleton className="h-10 w-1/2 rounded-2xl" />
            <div className="flex gap-2"><Skeleton className="h-9 w-24 rounded-full" /><Skeleton className="h-9 w-24 rounded-full" /></div>
          </div>
          <ListSkeleton rows={2} label="Cargando inicio" />
        </div>
        <div className="space-y-5">
          <Skeleton className="h-4 w-36" />
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="flex gap-3"><Skeleton className="mt-1 size-2.5 rounded-full" /><div className="flex-1 space-y-2"><Skeleton className="h-3.5 w-4/5" /><Skeleton className="h-3 w-1/3" /></div></div>
          ))}
        </div>
      </div>
    </div>
  );
}
