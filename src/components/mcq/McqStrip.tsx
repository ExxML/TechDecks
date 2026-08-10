'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { McqPanel } from './McqPanel';
import { McqSummary } from './McqSummary';
import { McqStepper } from './McqStepper';
import { shouldIgnoreShortcut } from '@/lib/keyboard';
import type { McqSet } from '@/lib/mcq/store';

type Props = {
  readonly set: McqSet;
  /** False when generation ran at the bottom of the grounding ladder. Surfaced
   *  once, in the summary panel — never repeated per question. */
  readonly grounded: boolean;
  readonly onAnswer: (index: number, selectedIndex: number) => void;
  readonly onRetry: () => void;
  readonly onRegenerate: () => void;
  /** Escape leaves the question flow and returns to the description. */
  readonly onExit?: () => void;
};

/**
 * One panel per question plus a summary, snapping horizontally against the
 * feed's vertical snap. Panel count comes from the set; nothing assumes 4.
 */
export function McqStrip({ set, grounded, onAnswer, onRetry, onRegenerate, onExit }: Props) {
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

  // Mirrors of what the key handler needs, so the listener is bound once rather
  // than torn down and rebuilt on every panel change or answer.
  const stateRef = useRef({ active, set, onAnswer, onExit });
  useEffect(() => {
    stateRef.current = { active, set, onAnswer, onExit };
  }, [active, set, onAnswer, onExit]);

  /**
   * Keyboard control for the question flow.
   *
   * Left/Right move panels, 1-4 (and A-D) commit an answer, Escape leaves.
   * Vertical arrows are deliberately NOT handled: they belong to the feed's
   * native scroll-snap, which already does the right thing.
   */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (shouldIgnoreShortcut(e)) return;
      const { active: at, set: current, onAnswer: answer, onExit: exit } = stateRef.current;
      const lastPanel = current.questions.length; // the summary

      if (e.key === 'ArrowRight') {
        e.preventDefault();
        scrollTo(Math.min(at + 1, lastPanel));
        return;
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        scrollTo(Math.max(at - 1, 0));
        return;
      }
      if (e.key === 'Escape' && exit) {
        e.preventDefault();
        exit();
        return;
      }

      // Answering applies to a question panel only, never the summary.
      if (at >= current.questions.length) return;
      // One attempt per question: a committed answer cannot be changed, by
      // keyboard any more than by tap.
      if ((current.answers[at] ?? null) !== null) return;

      const fromDigit = '1234'.indexOf(e.key);
      const fromLetter = 'abcd'.indexOf(e.key.toLowerCase());
      const choice = fromDigit >= 0 ? fromDigit : fromLetter;
      if (choice >= 0) {
        e.preventDefault();
        answer(at, choice);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [scrollTo]);

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
        <McqSummary
          set={set}
          grounded={grounded}
          onRetry={onRetry}
          onRegenerate={onRegenerate}
        />
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
