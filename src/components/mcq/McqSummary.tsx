import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import type { McqSet } from '@/lib/mcq/store';

type Props = {
  readonly set: McqSet;
  readonly grounded: boolean;
  /** Measured by the strip, which pages in pixels. */
  readonly width: number;
  readonly onRetry: () => void;
  readonly onRegenerate: () => void;
};

/** Final panel appended to the strip: score, per-kind breakdown, actions. */
export function McqSummary({ set, grounded, width, onRetry, onRegenerate }: Props) {
  const total = set.questions.length;
  const answered = set.answers.filter((a): a is NonNullable<typeof a> => a !== null);
  const score = answered.filter((a) => a.correct).length;
  const complete = answered.length >= total;

  return (
    <div
      className="no-scrollbar h-full shrink-0 overflow-y-auto overscroll-y-contain px-4 pb-4"
      // Vertical panning is the browser's — see ProblemCard's description body.
      style={{ width, touchAction: 'pan-y' }}
    >
      <p className="pt-3 pb-2 text-[12px] leading-none tracking-wide text-[var(--color-text-muted)] uppercase">
        Summary
      </p>

      <p className="text-[24px] leading-none font-medium text-[var(--color-text)]">
        {score} / {total}
      </p>
      <p className="mt-1 text-[13px] text-[var(--color-text-muted)]">
        {complete ? 'Complete' : `${answered.length} of ${total} answered`}
      </p>

      {/* One muted badge, here only. Repeating it per question would turn a
          caveat into noise and train the reader to ignore it. */}
      {!grounded && (
        <Badge className="mt-3 border border-[var(--color-border)] text-[var(--color-text-muted)]">
          Ungrounded — verify independently
        </Badge>
      )}

      <ul className="mt-4 flex flex-col gap-1.5">
        {set.questions.map((q, i) => {
          const a = set.answers[i] ?? null;
          return (
            <li
              key={i}
              className="flex items-center justify-between rounded-[4px] border border-[var(--color-border)] px-3 py-2"
            >
              <span className="text-[13px] text-[var(--color-text)]">{q.kind}</span>
              <span
                className="text-[12px] leading-none"
                style={{
                  color: !a
                    ? 'var(--color-text-muted)'
                    : a.correct
                      ? 'var(--color-correct)'
                      : 'var(--color-incorrect)',
                }}
              >
                {!a ? 'Skipped' : a.correct ? 'Correct' : 'Incorrect'}
              </span>
            </li>
          );
        })}
      </ul>

      <div className="mt-4 flex gap-2">
        {/* Retry clears answers in place — a new set would consume one of the
            five retained slots for identical questions. */}
        <Button variant="secondary" className="flex-1" onClick={onRetry}>
          Retry
        </Button>
        <Button variant="secondary" className="flex-1" onClick={onRegenerate}>
          Regenerate
        </Button>
      </div>
    </div>
  );
}
