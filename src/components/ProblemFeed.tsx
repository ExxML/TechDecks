'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ProblemCard } from './ProblemCard';
import { Skeleton } from './ui/Skeleton';
import { usePager } from '@/lib/pager';
import { shouldIgnoreShortcut } from '@/lib/keyboard';
import type { ContentItem, FeedCursor } from '@/lib/types';

type Props = {
  readonly initialItems: readonly ContentItem[];
  readonly initialCursor: FeedCursor | null;
};

/** Cards kept mounted either side of the active one. One is enough to render
 *  the peek during a drag; more only multiplies McqController's store reads. */
const WINDOW = 1;
/** Load the next page this many cards from the end. */
const PREFETCH_WITHIN = 3;

/**
 * The horizontal card feed.
 *
 * Cards live on one transformed track driven by `usePager` rather than by
 * scroll-snap, so a trackpad flick, a mouse wheel and a thumb swipe all move
 * exactly one card. See lib/pager.ts for why the browser cannot be trusted
 * with this. Vertical scrolling inside a card is the browser's.
 *
 * `dvh` not `vh` — mobile browser chrome resizes vh, which produces a visible
 * jump as the URL bar hides.
 */
export function ProblemFeed({ initialItems, initialCursor }: Props) {
  const [items, setItems] = useState<readonly ContentItem[]>(initialItems);
  const [cursor, setCursor] = useState<FeedCursor | null>(initialCursor);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);

  // Which cards are showing questions. Held here rather than in ProblemCard
  // because a windowed card unmounts as it leaves the window, and a reader who
  // pages away mid-question must find the question still there on return.
  const [questionCards, setQuestionCards] = useState<ReadonlySet<string>>(() => new Set());

  const rootRef = useRef<HTMLDivElement>(null);
  const [pageSize, setPageSize] = useState(0);

  // Ref mirrors of the paging state, so loadMore can be bound once and still
  // read current values. Synced in an effect, never during render.
  const cursorRef = useRef(cursor);
  const loadingRef = useRef(loading);
  useEffect(() => {
    cursorRef.current = cursor;
    loadingRef.current = loading;
  }, [cursor, loading]);

  // The card width in px. Measured rather than taken from the viewport: the
  // pager works in pixels, and this is the one number the track depends on.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const measure = () => setPageSize(el.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const loadMore = useCallback(async () => {
    const c = cursorRef.current;
    if (!c || loadingRef.current) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/feed?sortKey=${c.sortKey}&id=${encodeURIComponent(c.id)}`);
      if (!res.ok) throw new Error(`feed request failed: ${res.status}`);
      const page = (await res.json()) as { items: ContentItem[]; nextCursor: FeedCursor | null };
      setItems((prev) => {
        // Guard against a duplicate page if two loads race.
        const seen = new Set(prev.map((p) => p.id));
        return [...prev, ...page.items.filter((i) => !seen.has(i.id))];
      });
      setCursor(page.nextCursor);
    } catch {
      // Leave the cursor intact so the next approach retries.
      setCursor(cursorRef.current);
    } finally {
      setLoading(false);
    }
  }, []);

  // Infinite scroll. Driven by the active index rather than a sentinel: with a
  // windowed track there is no element near the end to observe.
  useEffect(() => {
    if (items.length - active <= PREFETCH_WITHIN) void loadMore();
  }, [active, items.length, loadMore]);

  // Reflect the active card in the URL without a navigation, so a deep link can
  // be copied mid-feed and the back button still leaves the feed.
  useEffect(() => {
    const slug = items[active]?.slug;
    if (slug && window.location.pathname !== `/problems/${slug}`) {
      window.history.replaceState(null, '', `/problems/${slug}`);
    }
  }, [active, items]);

  const pager = usePager({
    axis: 'x',
    count: items.length,
    index: active,
    onIndexChange: setActive,
    pageSize,
  });

  // Left/Right page the feed; the vertical keys belong to the description, and
  // are left to the browser once it has focus. A card showing its questions
  // yields Left/Right to the strip, which steps panels with them.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (shouldIgnoreShortcut(e)) return;
      if (questionCards.has(items[active]?.id ?? '')) return;
      const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (!step) return;
      e.preventDefault();
      pager.goTo(active + step);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [active, items, questionCards, pager]);

  const setInQuestions = useCallback((id: string, on: boolean) => {
    setQuestionCards((prev) => {
      if (prev.has(id) === on) return prev;
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const first = Math.max(0, active - WINDOW);
  const last = Math.min(items.length - 1, active + WINDOW);
  const window_ = items.slice(first, last + 1);

  return (
    <div
      ref={(node) => {
        rootRef.current = node;
        pager.ref(node);
      }}
      // tabIndex makes the feed focusable so it can be reached by keyboard;
      // the key handler above acts globally once it is.
      tabIndex={0}
      role="region"
      aria-label="Problem feed"
      aria-roledescription="carousel"
      className="relative h-[calc(100dvh-48px)] overflow-hidden focus:outline-none"
      // No gesture starting here is the browser's: the pager pages on the
      // horizontal axis, and the only vertical panning that should happen is
      // inside a scroller, which opts back in with its own pan-y.
      style={{ touchAction: 'none' }}
      {...pager.handlers}
    >
      <div
        className="absolute inset-y-0 left-0 will-change-transform"
        style={{
          transform: `translate3d(${pager.offset}px, 0, 0)`,
          // No transition while the finger is down: the card tracks the drag.
          transition: pager.dragging ? 'none' : 'transform 260ms cubic-bezier(0.22, 1, 0.36, 1)',
          visibility: pageSize ? undefined : 'hidden',
        }}
      >
        {/* Only the window is mounted, so each card is placed at its absolute
            index — the track's transform does the rest. */}
        {window_.map((item, i) => (
          <div
            key={item.id}
            className="absolute inset-y-0"
            style={{ left: (first + i) * pageSize, width: pageSize }}
            aria-hidden={first + i !== active}
          >
            <ProblemCard
              item={item}
              active={first + i === active}
              inQuestions={questionCards.has(item.id)}
              onQuestionsChange={(on) => setInQuestions(item.id, on)}
            />
          </div>
        ))}

        {loading && (
          <div
            className="absolute inset-y-0 flex flex-col gap-3 p-4"
            style={{ left: items.length * pageSize, width: pageSize }}
            aria-hidden="true"
          >
            <Skeleton className="h-6 w-3/4" />
            <Skeleton className="h-3 w-1/3" />
            <Skeleton className="mt-2 h-full w-full" />
          </div>
        )}
      </div>

      {!cursor && !loading && active === items.length - 1 && (
        <p className="pointer-events-none absolute inset-x-0 bottom-2 text-center text-[13px] text-[var(--color-text-muted)]">
          End of feed
        </p>
      )}
    </div>
  );
}
