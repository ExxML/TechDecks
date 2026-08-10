type Props = {
  readonly text: string;
  readonly index: number;
  readonly selected: boolean;
  readonly isCorrect: boolean;
  readonly committed: boolean;
  readonly onSelect: () => void;
};

const LETTERS = ['A', 'B', 'C', 'D'];

/** Multi-line code blocks render as code; short prose renders as prose. */
function isCodeLike(text: string): boolean {
  return text.includes('\n') || /^\s*(class|def|function|public|const|let|var|for|while|if)\b/.test(text);
}

/**
 * Tap commits immediately — one attempt, no Submit button. On commit the
 * correct option borders green and a wrong choice borders red, with the correct
 * one still marked.
 */
export function McqOption({ text, index, selected, isCorrect, committed, onSelect }: Props) {
  let borderColor = 'var(--color-border)';
  let background = 'var(--color-surface-alt)';

  if (committed) {
    if (isCorrect) {
      borderColor = 'var(--color-correct)';
      background = 'var(--color-correct-wash)';
    } else if (selected) {
      borderColor = 'var(--color-incorrect)';
      background = 'var(--color-incorrect-wash)';
    }
  }

  const code = isCodeLike(text);

  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={committed}
      aria-pressed={selected}
      // The letter is also the keyboard shortcut, so name it for anyone who
      // cannot see the badge.
      aria-keyshortcuts={committed ? undefined : LETTERS[index]}
      className={
        'w-full rounded-[4px] border px-3 py-2.5 text-left transition-colors duration-100 ' +
        (committed ? 'cursor-default' : 'hover:border-[var(--color-text-muted)]')
      }
      style={{ borderColor, background }}
    >
      <div className="flex gap-2.5">
        <span
          className="shrink-0 text-[12px] leading-5 font-medium"
          style={{
            color:
              committed && isCorrect
                ? 'var(--color-correct)'
                : committed && selected
                  ? 'var(--color-incorrect)'
                  : 'var(--color-text-muted)',
          }}
        >
          {LETTERS[index]}
        </span>
        {code ? (
          <pre className="min-w-0 flex-1 overflow-x-auto font-[family-name:var(--font-mono)] text-[12px] leading-[1.5] whitespace-pre">
            {text}
          </pre>
        ) : (
          <span className="min-w-0 flex-1 text-[14px] leading-[1.45]">{text}</span>
        )}
      </div>
    </button>
  );
}
