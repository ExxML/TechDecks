import { Skeleton } from './ui/Skeleton';

/**
 * Placeholder rows at the same 56px height CompactList uses, so /search and
 * /bookmarks do not jump when results arrive.
 */
export function CompactListSkeleton({ rows = 8 }: { readonly rows?: number }) {
  return (
    <ul aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <li key={i} className="border-b border-[var(--color-border)]">
          <div className="flex h-[56px] flex-col justify-center gap-2 px-4">
            <Skeleton className="h-3.5 w-1/2" />
            <Skeleton className="h-2.5 w-24" />
          </div>
        </li>
      ))}
    </ul>
  );
}
