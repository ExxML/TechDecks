'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { McqPanel } from './McqPanel';
import { McqSummary } from './McqSummary';
import { McqStepper } from './McqStepper';
import type { McqSet } from '@/lib/mcq/store';

type Props = {
  readonly set: McqSet;
  readonly onAnswer: (index: number, selectedIndex: number) => void;
  readonly onRetry: () => void;
  readonly onRegenerate: () => void;
};

/**
 * One panel per question plus a summary, snapping horizontally against the
 * feed's vertical snap. Panel count comes from the set; nothing assumes 4.
 */
export function McqStrip({ set, onAnswer, onRetry, onRegenerate }: Props) {
  const stripRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const panelCount = set.questions.length + 1; // + summary

  const scrollTo = useCallback((index: number) => {
    const strip = stripRef.current;
    if (!strip) return;
    strip.scrollTo({ left: index * strip.clientWidth, behavior: 'smooth' });
  }, []);

  // Track which panel is showing so the stepper stays in sync with a manual swipe.
  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const width = strip.clientWidth;
        if (width > 0) setActive(Math.round(strip.scrollLeft / width));
      });
    };
    strip.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      strip.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(frame);
    };
  }, []);

  const answeredFlags = set.questions.map((_, i) => (set.answers[i] ?? null) !== null);

  return (
    <div className="grid min-h-0 grid-rows-[1fr_auto]">
      <div
        ref={stripRef}
        className="no-scrollbar flex min-h-0 snap-x snap-mandatory overflow-x-auto overflow-y-hidden overscroll-x-contain"
      >
        {set.questions.map((q, i) => (
          <McqPanel
            key={i}
            question={q}
            answer={set.answers[i] ?? null}
            onAnswer={(selected) => onAnswer(i, selected)}
          />
        ))}
        <McqSummary set={set} onRetry={onRetry} onRegenerate={onRegenerate} />
      </div>

      <McqStepper
        count={panelCount}
        active={active}
        answered={[...answeredFlags, false]}
        onSelect={scrollTo}
      />
    </div>
  );
}
