'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft } from 'lucide-react';
import { ProblemHeader } from './ProblemHeader';
import { ProblemBody } from './ProblemBody';
import { McqController } from './mcq/McqController';
import type { ContentItem } from '@/lib/types';

/**
 * One full-viewport card in one of two states that never coexist: Reading
 * (scrollable body carrying the problem header, then the action bar) and
 * Questions (one-line title bar, then the MCQ strip).
 *
 * The body scroller's `overscroll-behavior-y: contain` stops a mid-read scroll
 * from snapping the card away, which also means a swipe there can never advance
 * the feed.
 */
export function ProblemCard({ item }: { readonly item: ContentItem }) {
  const [inQuestions, setInQuestions] = useState(false);

  // The fade only means "more below", so it must vanish at the end of the body
  // and for bodies too short to scroll at all.
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [atBodyEnd, setAtBodyEnd] = useState(true);

  const measureBody = useCallback(() => {
    const el = bodyRef.current;
    if (!el) return;
    // 1px slack: fractional layout heights never sum to exactly scrollHeight.
    setAtBodyEnd(el.scrollTop + el.clientHeight >= el.scrollHeight - 1);
  }, []);

  // Runs when the body row mounts (State A) and whenever it resizes — images
  // and MathJax-style content settle after the first paint.
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    measureBody();
    const observer = new ResizeObserver(measureBody);
    observer.observe(el);
    for (const child of Array.from(el.children)) observer.observe(child);
    return () => observer.disconnect();
  }, [inQuestions, measureBody]);

  return (
    <article
      data-slug={item.slug}
      className={`grid h-[calc(100dvh-48px)] w-full shrink-0 snap-start border-b border-[var(--color-border)] bg-[var(--color-bg)] ${
        inQuestions ? 'grid-rows-[auto_1fr]' : 'grid-rows-[1fr_auto]'
      }`}
    >
      {/* State B: header collapses to one line with a way back. */}
      {inQuestions && (
        <div className="flex items-center gap-2 border-b border-[var(--color-border)] px-3 py-2.5">
          <button
            type="button"
            onClick={() => setInQuestions(false)}
            className="flex items-center gap-1 text-[13px] text-[var(--color-text-muted)] transition-colors duration-100 hover:text-[var(--color-text)]"
          >
            <ChevronLeft size={16} />
            Description
          </button>
          <span className="min-w-0 flex-1 truncate text-right text-[13px] text-[var(--color-text)]">
            {item.title}
          </span>
        </div>
      )}

      {/* 1fr row. ProblemBody is NOT visible in State B. */}
      {inQuestions ? (
        <McqController
          item={item}
          inQuestions
          onEnterQuestions={() => setInQuestions(true)}
          onNoSet={() => setInQuestions(false)}
        />
      ) : (
        <div className="relative min-h-0">
          {/* pb-10 clears the h-8 fade, so the last line is never sat on. */}
          <div
            ref={bodyRef}
            onScroll={measureBody}
            className="no-scrollbar h-full overflow-y-auto overscroll-y-contain px-4 pb-10"
          >
            <ProblemHeader item={item} />
            <ProblemBody html={item.body_html} format={item.body_format} />
          </div>
          {/* Fade mask signalling more content below — hidden once there is none. */}
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 h-8 transition-opacity duration-100"
            style={{
              background: 'linear-gradient(to top, var(--color-bg), transparent)',
              opacity: atBodyEnd ? 0 : 1,
            }}
            aria-hidden="true"
          />
        </div>
      )}

      {/* Bottom row (auto). In State B the strip owns the 1fr row and carries
          its own stepper, so the action bar belongs to State A only. */}
      {!inQuestions && (
        <McqController
          item={item}
          inQuestions={false}
          onEnterQuestions={() => setInQuestions(true)}
          onNoSet={() => setInQuestions(false)}
        />
      )}
    </article>
  );
}
