import { Skeleton } from '@/components/ui/skeleton';

/** loading state ร่วมของทุกหน้า */
export default function Loading(): JSX.Element {
  return (
    <div className="space-y-4">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-4 w-80" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((index) => (
          <Skeleton key={index} className="h-32 rounded-card" />
        ))}
      </div>
      <Skeleton className="h-64 rounded-card" />
    </div>
  );
}
