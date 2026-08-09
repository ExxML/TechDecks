import { ProblemHeader } from './ProblemHeader';
import { ProblemBody } from './ProblemBody';
import { Button } from './ui/Button';
import type { ContentItem } from '@/lib/types';

/**
 * One full-viewport card.
 *
 * State A (Reading) only at P1 — the MCQ strip arrives in P2.
 *
 * Layout is `grid-rows-[auto_1fr_auto]`:
 *   - header (auto)  — the density cap, and the escape-gesture zone
 *   - body   (1fr)   — the only scroller
 *   - action (auto)  — Generate
 *
 * THE ESCAPE GESTURE. The body uses `overscroll-behavior-y: contain`, which is
 * what stops a mid-read scroll from chaining into the feed and snapping the
 * card away. The cost is that a swipe starting over the description can never
 * advance the feed — so on a 3-screen problem the user would be trapped.
 *
 * The fix is that the header row is NOT a scroller: it has no overflow of its
 * own, so a swipe starting there falls through to the snap container and moves
 * the feed. That is why the header sits outside the scrolling region rather
 * than inside it, and why nothing scrollable may be added to it.
 */
export function ProblemCard({ item }: { readonly item: ContentItem }) {
  const questionCount = 4; // synced problems always get the preset four

  return (
    <article
      data-slug={item.slug}
      className="h-[calc(100dvh-48px)] w-full shrink-0 snap-start grid grid-rows-[auto_1fr_auto] border-b border-[var(--color-border)] bg-[var(--color-bg)]"
    >
      {/* Not a scroller — this is the escape-gesture zone. */}
      <ProblemHeader item={item} />

      {/* The only scrolling region. `contain` prevents scroll chaining. */}
      <div className="relative min-h-0">
        <div className="no-scrollbar h-full overflow-y-auto overscroll-y-contain px-4 pb-4">
          <ProblemBody html={item.body_html} />
        </div>
        {/* Fade mask signalling more content below. A mask, not a gradient
            fill — it tints nothing, it only reveals the scroll edge. */}
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 h-8"
          style={{
            background: 'linear-gradient(to top, var(--color-bg), transparent)',
          }}
          aria-hidden="true"
        />
      </div>

      <div className="border-t border-[var(--color-border)] px-4 py-3">
        <Button variant="primary" className="w-full" disabled>
          Generate Questions
        </Button>
        <p className="mt-1.5 text-center text-[13px] leading-none text-[var(--color-text-muted)]">
          {questionCount} questions · Approach, Algorithm, Complexity, Solution
        </p>
      </div>
    </article>
  );
}
