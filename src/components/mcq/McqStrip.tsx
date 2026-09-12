'use client';

import { useEffect, useRef, useState } from 'react';
import { McqPanel } from './McqPanel';
import { McqSummary } from './McqSummary';
import { McqStepper } from './McqStepper';
import { usePager } from '@/lib/pager';
import { shouldIgnoreShortcut } from '@/lib/keyboard';
import type { McqSet } from '@/lib/mcq/store';

type Props = {
  readonly set: McqSet;
  /** False when generation ran at the bottom of the grounding ladder. Surfaced
   *  once, in the summary panel — never repeated per question. */
  readonly grounded: boolean;
  /** False on a peeking card, whose key handler must not answer the reader's
   *  question on the card they are actually looking at. */
  readonly active: boolean;
  readonly onAnswer: (index: number, selectedIndex: number) => void;
  readonly onRetry: () => void;
  /** Clears one question's answer, leaving the rest of the set's progress. */
  readonly onResetOne: (index: number) => void;
  readonly onRegenerate: () => void;
  /** Escape leaves the question flow and returns to the description. */
  readonly onExit?: () => void;
};

/**
 * One panel per question plus a summary. Panel count comes from the set;
 * nothing assumes 4.
 *
 * Shares `usePager` with the feed and pages on the same axis, so it isolates
 * its gestures: inside the questions view, sideways means panel, not card.
 */
export function McqStrip({
  set,
  grounded,
  active,
  onAnswer,
  onRetry,
  onResetOne,
  onRegenerate,
  onExit,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [panel, setPanel] = useState(0);
  const [pageSize, setPageSize] = useState(0);
  const panelCount = set.questions.length + 1; // + summary
  // A regenerated set can be shorter than the panel we were on, so the index is
  // clamped on read rather than corrected by an effect after a bad render.
  const at = Math.min(panel, panelCount - 1);

  // Panel width in px. Measured, since the pager works in pixels and the strip
  // is not always the full viewport.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const measure = () => setPageSize(el.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const pager = usePager({
    axis: 'x',
    count: panelCount,
    index: at,
    onIndexChange: setPanel,
    pageSize,
    enabled: active,
    // The feed pages on the same axis: inside the questions view, sideways
    // means panel, not card.
    isolate: true,
  });

  const answeredFlags = set.questions.map((_, i) => (set.answers[i] ?? null) !== null);

  // Mirrors of what the key handler needs, so the listener is bound once rather
  // than torn down and rebuilt on every panel change or answer.
  const stateRef = useRef({ at, set, active, onAnswer, onExit, goTo: pager.goTo });
  useEffect(() => {
    stateRef.current = { at, set, active, onAnswer, onExit, goTo: pager.goTo };
  });

  /**
   * Keyboard control for the question flow.
   *
   * Left/Right move panels, 1-4 (and A-D) commit an answer, Escape leaves.
   * Vertical arrows are deliberately NOT handled: they belong to the feed,
   * which pages cards with them.
   */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (shouldIgnoreShortcut(e)) return;
      const { at: panel, set: current, active: on, onAnswer: answer, onExit: exit, goTo } = stateRef.current;
      if (!on) return;
      const lastPanel = current.questions.length; // the summary

      if (e.key === 'ArrowRight') {
        e.preventDefault();
        goTo(Math.min(panel + 1, lastPanel));
        return;
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        goTo(Math.max(panel - 1, 0));
        return;
      }
      if (e.key === 'Escape' && exit) {
        e.preventDefault();
        exit();
        return;
      }

      // Answering applies to a question panel only, never the summary.
      if (panel >= current.questions.length) return;
      // One attempt per question: a committed answer cannot be changed, by
      // keyboard any more than by tap.
      if ((current.answers[panel] ?? null) !== null) return;

      const fromDigit = '1234'.indexOf(e.key);
      const fromLetter = 'abcd'.indexOf(e.key.toLowerCase());
      const choice = fromDigit >= 0 ? fromDigit : fromLetter;
      if (choice >= 0) {
        e.preventDefault();
        answer(panel, choice);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div className="grid min-h-0 grid-rows-[1fr_auto]">
      <div
        ref={(node) => {
          rootRef.current = node;
          pager.ref(node);
        }}
        className="relative min-h-0 overflow-hidden"
        // This pager owns the horizontal axis, and the panels opt back into
        // vertical panning themselves — see the feed root.
        style={{ touchAction: 'none' }}
        {...pager.handlers}
      >
        <div
          className="absolute inset-y-0 left-0 flex will-change-transform"
          style={{
            width: panelCount * pageSize,
            transform: `translate3d(${pager.offset}px, 0, 0)`,
            transition: pager.dragging ? 'none' : 'transform 260ms cubic-bezier(0.22, 1, 0.36, 1)',
            visibility: pageSize ? undefined : 'hidden',
          }}
        >
          {set.questions.map((q, i) => (
            <McqPanel
              key={i}
              question={q}
              answer={set.answers[i] ?? null}
              width={pageSize}
              onAnswer={(selected) => onAnswer(i, selected)}
              onReset={() => onResetOne(i)}
            />
          ))}
          <McqSummary
            set={set}
            grounded={grounded}
            width={pageSize}
            onRetry={onRetry}
            onResetOne={onResetOne}
            onRegenerate={onRegenerate}
          />
        </div>
      </div>

      <McqStepper
        count={panelCount}
        active={at}
        answered={[...answeredFlags, false]}
        onSelect={pager.goTo}
      />
    </div>
  );
}
