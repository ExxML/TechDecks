import { McqOption } from './McqOption';
import { KIND_LABELS, type Mcq } from '@/lib/gemini/schema';
import type { McqAnswer } from '@/lib/mcq/store';

type Props = {
  readonly question: Mcq;
  readonly answer: McqAnswer | null;
  readonly onAnswer: (selectedIndex: number) => void;
};

/**
 * The explanation stays hidden until commit, since it contains the answer, and
 * there is no auto-advance past it.
 */
export function McqPanel({ question, answer, onAnswer }: Props) {
  const committed = answer !== null;
  // Authored kinds fall back to the raw kind name.
  const gloss = KIND_LABELS[question.kind.toLowerCase()];

  return (
    <div className="no-scrollbar h-full w-full shrink-0 snap-start overflow-y-auto overscroll-y-contain px-4 pb-4">
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
          <p className="mb-1 text-[12px] leading-none font-medium text-[var(--color-text-muted)]">
            {answer.correct ? 'Correct' : 'Incorrect'}
          </p>
          <p className="text-[13px] leading-[1.5] text-[var(--color-text)]">{question.explanation}</p>
        </div>
      )}
    </div>
  );
}
