"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ProblemHeader } from "./ProblemHeader";
import { ProblemBody } from "./ProblemBody";
import { McqController } from "./mcq/McqController";
import type { ContentItem } from "@/lib/types";

type Props = {
  readonly item: ContentItem;
  /** False for the cards peeking either side, whose keyboard handlers must not
   *  compete with the active card's. */
  readonly active: boolean;
  /** Owned by the feed: a card unmounts when it leaves the window, and the
   *  question flow has to survive that. */
  readonly inQuestions: boolean;
  readonly onQuestionsChange: (inQuestions: boolean) => void;
};

/**
 * One full-viewport card in one of two states that never coexist: Reading
 * (scrollable body carrying the problem header, the description and the action
 * bar) and Questions (the MCQ strip).
 *
 * The body is an ordinary scroller, panned by the browser. Paging is the
 * perpendicular axis, so a long description never traps the reader on the card.
 */
export function ProblemCard({
  item,
  active,
  inQuestions,
  onQuestionsChange,
}: Props) {
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
      // Both states render a single child that must get the whole card, so the
      // one row is always 1fr.
      className="grid h-full w-full grid-rows-[1fr] border-r border-[var(--color-border)] bg-[var(--color-bg)]"
    >
      {/* 1fr row. ProblemBody is NOT visible in State B. */}
      {inQuestions ? (
        <McqController
          item={item}
          active={active}
          inQuestions
          onEnterQuestions={() => onQuestionsChange(true)}
          onNoSet={() => onQuestionsChange(false)}
        />
      ) : (
        <div
          ref={bodyRef}
          onScroll={measureBody}
          className="no-scrollbar h-full overflow-y-auto overscroll-y-contain"
          // The browser owns vertical panning here, so reading a description
          // runs on the compositor with native momentum. Horizontal is left
          // to the feed's pager, which pages cards on that axis.
          style={{ touchAction: "pan-y" }}
        >
          {/* min-h-full so a description shorter than the card still carries the
              action bar to the bottom edge, via the mt-auto below. */}
          <div className="flex min-h-full flex-col">
            {/* pb-8 clears the h-8 fade, so the last line is never sat on. */}
            <div className="px-4 pb-8">
              <ProblemHeader item={item} />
              <ProblemBody html={item.body_html} format={item.body_format} />
            </div>

            {/* The action bar scrolls with the description rather than sitting
                beside it, so a gesture over it pans the same scroller; sticky
                keeps it pinned to the card's bottom edge. Last in flow, so the
                space it occupies is reserved and no text hides beneath it. */}
            <div className="sticky bottom-0 mt-auto bg-[var(--color-bg)]">
              {/* Fade mask signalling more content below — hidden once there is
                  none. Sits above the bar, outside its flow. */}
              <div
                className="pointer-events-none absolute inset-x-0 bottom-full h-8 transition-opacity duration-100"
                style={{
                  background:
                    "linear-gradient(to top, var(--color-bg), transparent)",
                  opacity: atBodyEnd ? 0 : 1,
                }}
                aria-hidden="true"
              />
              <McqController
                item={item}
                active={active}
                inQuestions={false}
                onEnterQuestions={() => onQuestionsChange(true)}
                onNoSet={() => onQuestionsChange(false)}
              />
            </div>
          </div>
        </div>
      )}
    </article>
  );
}
