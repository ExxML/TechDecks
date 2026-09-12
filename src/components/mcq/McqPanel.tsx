import { RotateCcw } from 'lucide-react';
import { McqOption } from './McqOption';
import { KIND_LABELS, type Mcq } from '@/lib/gemini/schema';
import type { McqAnswer } from '@/lib/mcq/store';

type Props = {
  readonly question: Mcq;
  readonly answer: McqAnswer | null;
  /** Measured by the strip, which pages in pixels. */
  readonly width: number;
  readonly onAnswer: (selectedIndex: number) => void;
  /** Clears this question's answer so it can be attempted again, leaving the
   *  rest of the set's progress alone. */
  readonly onReset: () => void;
};

/**
 * The explanation stays hidden until commit, since it contains the answer, and
 * there is no auto-advance past it.
 */
export function McqPanel({ question, answer, width, onAnswer, onReset }: Props) {
  const committed = answer !== null;
  // Authored kinds fall back to the raw kind name.
  const gloss = KIND_LABELS[question.kind.toLowerCase()];

  return (
    <div
      className="no-scrollbar h-full shrink-0 overflow-y-auto overscroll-y-contain px-4 pb-4"
      // Vertical panning is the browser's — see ProblemCard's description body.
      style={{ width, touchAction: 'pan-y' }}
    >
      <p className="pt-3 pb-2 text-[12px] leading-none tracking-wide text-[var(--color-text-muted)] uppercase">
        {question.kind}
        {gloss ? ` · ${gloss}` : ''}
      </p>

      <p className="mb-3 text-[14px] leading-[1.5] text-[var(--color-text)]">{question.question}</p>

      <div className="flex flex-col gap-2">
        {question.options.map((opt, i) => (
          <McqOption
            key={i}
            text={opt.text}
            index={i}
            selected={answer?.selected_index === i}
            isCorrect={question.correct_index === i}
            committed={committed}
            onSelect={() => !committed && onAnswer(i)}
          />
        ))}
      </div>

      {/* Shortcut hint on pointer devices only: it is noise on a phone, where
          there is no keyboard to use. */}
      {!committed && (
        <p className="mt-2 hidden text-[12px] leading-none text-[var(--color-text-muted)] [@media(any-hover:hover)]:block">
          Press 1–4 to answer · ← → to move
        </p>
      )}

      {committed && (
        <div className="mt-3 rounded-[4px] border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
          <div className="mb-1 flex items-center justify-between gap-2">
            <p className="text-[12px] leading-none font-medium text-[var(--color-text-muted)]">
              {answer.correct ? 'Correct' : 'Incorrect'}
            </p>
            {/* One question, not the set: the reader who wants another go at
                this one has not asked to lose the others. */}
            <button
              type="button"
              onClick={onReset}
              aria-label="Try this question again"
              className="flex items-center gap-1 text-[12px] leading-none text-[var(--color-text-muted)] transition-colors duration-100 hover:text-[var(--color-text)]"
            >
              <RotateCcw size={12} />
              Try again
            </button>
          </div>
          <p className="text-[13px] leading-[1.5] text-[var(--color-text)]">{question.explanation}</p>
        </div>
      )}
    </div>
  );
}
