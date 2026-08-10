type Props = {
  /** Read from the set's length. NEVER a hardcoded 4. */
  readonly count: number;
  readonly active: number;
  readonly answered: readonly boolean[];
  readonly onSelect: (index: number) => void;
};

/** One dot per question, sized from `count`. */
export function McqStepper({ count, active, answered, onSelect }: Props) {
  return (
    <div className="flex items-center justify-center gap-1.5 py-2" role="tablist" aria-label="Questions">
      {Array.from({ length: count }, (_, i) => {
        const isActive = i === active;
        const isAnswered = answered[i] === true;
        return (
          <button
            key={i}
            type="button"
            role="tab"
            aria-selected={isActive}
            aria-label={`Question ${i + 1} of ${count}${isAnswered ? ', answered' : ''}`}
            onClick={() => onSelect(i)}
            className="p-1"
          >
            {/* Dots are the one place a full radius is allowed. */}
            <span
              className="block h-1.5 w-1.5 rounded-full transition-colors duration-100"
              style={{
                background: isActive
                  ? 'var(--color-accent)'
                  : isAnswered
                    ? 'var(--color-text-muted)'
                    : 'var(--color-border)',
              }}
            />
          </button>
        );
      })}
    </div>
  );
}
