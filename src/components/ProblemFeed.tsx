'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ProblemCard } from './ProblemCard';
import { Skeleton } from './ui/Skeleton';
import type { ContentItem, FeedCursor } from '@/lib/types';

type Props = {
  readonly initialItems: readonly ContentItem[];
  readonly initialCursor: FeedCursor | null;
};

/**
 * The vertical snap feed.
 *
 * Native CSS scroll-snap, no gesture library: zero bundle cost, correct
 * momentum, and keyboard/desktop scrolling for free.
 *
 * `dvh` not `vh` — mobile browser chrome resizes vh, which produces a visible
 * jump as the URL bar hides.
 */
export function ProblemFeed({ initialItems, initialCursor }: Props) {
  const [items, setItems] = useState<readonly ContentItem[]>(initialItems);
  const [cursor, setCursor] = useState<FeedCursor | null>(initialCursor);
  const [loading, setLoading] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  // Ref mirrors of the paging state, so the IntersectionObserver callback can
  // read current values without the observer being torn down and rebuilt on
  // every state change. Synced in an effect, never during render.
  const cursorRef = useRef(cursor);
  const loadingRef = useRef(loading);

  useEffect(() => {
    cursorRef.current = cursor;
    loadingRef.current = loading;
  }, [cursor, loading]);

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
      // Leave the cursor intact so the next intersection retries.
      setCursor(cursorRef.current);
    } finally {
      setLoading(false);
    }
  }, []);

  // Infinite scroll: fire when the sentinel below the last card approaches.
  useEffect(() => {
    const el = sentinelRef.current;
    const root = containerRef.current;
    if (!el || !root) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void loadMore();
      },
      { root, rootMargin: '300% 0px' }, // prefetch ~3 cards ahead
    );
    io.observe(el);
    return () => io.disconnect();
  }, [loadMore]);

  // Reflect the active card in the URL without a navigation, so a deep link
  // can be copied mid-scroll and the back button still works.
  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        const slug = visible?.target.getAttribute('data-slug');
        if (slug && window.location.pathname !== `/problems/${slug}`) {
          window.history.replaceState(null, '', `/problems/${slug}`);
        }
      },
      { root, threshold: 0.6 },
    );
    for (const card of root.querySelectorAll('article[data-slug]')) io.observe(card);
    return () => io.disconnect();
  }, [items]);

  return (
    <div
      ref={containerRef}
      // tabIndex makes the scroller focusable, which is what gives arrow keys,
      // PageUp/PageDown and Home/End somewhere to act. Native scroll-snap then
      // does the paging itself — no key handler needed, and none that could
      // fight the browser's own momentum.
      tabIndex={0}
      role="region"
      aria-label="Problem feed"
      className="no-scrollbar h-[calc(100dvh-48px)] snap-y snap-mandatory overflow-y-auto focus:outline-none"
    >
      {items.map((item) => (
        <ProblemCard key={item.id} item={item} />
      ))}

      {/* Sentinel sits inside the scroller so rootMargin is measured against it. */}
      <div ref={sentinelRef} aria-hidden="true" className="h-px" />

      {loading && (
        <div className="flex h-[calc(100dvh-48px)] shrink-0 snap-start flex-col gap-3 p-4">
          <Skeleton className="h-6 w-3/4" />
          <Skeleton className="h-3 w-1/3" />
          <Skeleton className="mt-2 h-full w-full" />
        </div>
      )}

      {!cursor && !loading && (
        <div className="flex h-24 items-center justify-center text-[13px] text-[var(--color-text-muted)]">
          End of feed
        </div>
      )}
    </div>
  );
}
