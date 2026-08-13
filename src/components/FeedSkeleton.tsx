import { Skeleton } from './ui/Skeleton';

/**
 * Card-shaped placeholder for the feed.
 *
 * Rendered by a Suspense boundary INSIDE /problems rather than by a
 * loading.tsx: a loading file applies to the whole /problems segment,
 * including /problems/[slug], and its boundary makes the response stream
 * before the slug lookup runs — which turns a missing slug's notFound() into a
 * soft 404 (correct page, 200 status). Scoping the boundary to this one route
 * keeps the skeleton and lets the deep link return a real 404.
 */
export function FeedSkeleton() {
  return (
    <div className="grid h-[calc(100dvh-48px)] grid-rows-[1fr_auto]">
      <div className="min-h-0 px-4">
        <div className="pt-4 pb-3">
          <Skeleton className="h-5 w-3/4" />
          <div className="mt-3 flex gap-3">
            <Skeleton className="h-3 w-12" />
            <Skeleton className="h-3 w-20" />
          </div>
          <div className="mt-3 flex gap-1.5">
            <Skeleton className="h-4 w-14" />
            <Skeleton className="h-4 w-16" />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-5/6" />
          <Skeleton className="mt-3 h-20 w-full" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-2/3" />
        </div>
      </div>

      <div className="border-t border-[var(--color-border)] px-4 py-3">
        <Skeleton className="h-10 w-full" />
      </div>
    </div>
  );
}
