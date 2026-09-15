import Link from 'next/link';

/**
 * Reached by `notFound()` from /problems/[slug] when a slug does not resolve —
 * a stale bookmark, or a deleted authored problem.
 *
 * The feed is the front door, so that is where this points.
 */
export default function NotFound() {
  return (
    <div className="flex h-[calc(100dvh-48px)] flex-col items-center justify-center gap-3 px-6">
      <h1 className="text-[16px] font-medium text-[var(--color-text)]">Problem not found</h1>
      <p className="max-w-[320px] text-center text-[13px] leading-[1.5] text-[var(--color-text-muted)]">
        This problem doesn&rsquo;t exist, or it was deleted.
      </p>
      <Link
        href="/problems"
        className="text-[13px] text-[var(--color-accent)] underline underline-offset-2"
        draggable={false}
      >
        Back to problems
      </Link>
    </div>
  );
}
