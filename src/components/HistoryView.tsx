'use client';

import { ResultsView } from './ResultsView';
import { SignInPrompt } from './SignInPrompt';
import { CompactListSkeleton } from './CompactListSkeleton';
import { useUser } from '@/lib/auth';

/**
 * `/history` — problems the reader has opened, first visit first, searchable
 * and filterable exactly as `/search` is. Auth-gated: visits are per-user rows
 * behind `pv_all`, so there is nothing to show anonymously.
 */
export function HistoryView() {
  const { user, loading } = useUser();

  if (loading) return <CompactListSkeleton />;
  if (!user) return <SignInPrompt message="Sign in to keep a history of the problems you open." />;

  return (
    <ResultsView
      scope="history"
      basePath="/history"
      from="history"
      emptyMessage="No history yet. Problems you open will appear here."
      renderAction={(hit) => <VisitedAt at={hit.listed_at} />}
    />
  );
}

/** The first time this problem was opened. Recent visits read better relative
 *  ("2h ago"), older ones as a date — a week-old "168h ago" means nothing. */
function VisitedAt({ at }: { readonly at: string | null }) {
  if (!at) return null;
  return (
    <time
      dateTime={at}
      title={new Date(at).toLocaleString()}
      className="shrink-0 text-[12px] leading-none text-[var(--color-text-muted)] tabular-nums"
    >
      {formatVisited(at)}
    </time>
  );
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function formatVisited(iso: string): string {
  const then = new Date(iso);
  const elapsed = Date.now() - then.getTime();
  if (elapsed < MINUTE) return 'now';
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m ago`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h ago`;
  if (elapsed < 7 * DAY) return `${Math.floor(elapsed / DAY)}d ago`;
  return then.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    // The year only earns its place once it is not the current one.
    year: then.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
  });
}
