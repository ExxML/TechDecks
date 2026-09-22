import { ChevronRight } from "lucide-react";

type Props = {
  /** Read from the set's length. NEVER a hardcoded 4. */
  readonly count: number;
  readonly active: number;
  readonly answered: readonly boolean[];
  readonly onSelect: (index: number) => void;
  /** Leaves the question flow for the description. */
  readonly onExit: () => void;
};

/**
 * One dot per question, sized from `count`, plus the way back to the
 * description.
 *
 * This row is the card's bottom edge in State B and the only chrome on screen
 * for every panel, so it carries the exit: within thumb reach on a phone,
 * rather than at the top where a one-handed grip cannot go.
 */
export function McqStepper({
  count,
  active,
  answered,
  onSelect,
  onExit,
}: Props) {
  return (
    <div className="relative flex items-center justify-center gap-1.5 py-3.5">
      {/* Right-hand side, for a right thumb. Absolute so the dots stay centred
          on the card, not on the space left over beside the button. */}
      <button
        type="button"
        onClick={onExit}
        aria-label="Back to description"
        className="absolute inset-y-0 right-0 flex items-center gap-0.5 pr-4 pl-6 text-[13px] text-[var(--color-text-muted)] transition-colors duration-100 hover:text-[var(--color-text)]"
      >
        Description
        <ChevronRight size={16} />
      </button>

      <div
        className="flex items-center gap-1.5"
        role="tablist"
        aria-label="Questions"
      >
        {Array.from({ length: count }, (_, i) => {
          const isActive = i === active;
          const isAnswered = answered[i] === true;
          return (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-label={`Question ${i + 1} of ${count}${isAnswered ? ", answered" : ""}`}
              onClick={() => onSelect(i)}
              className="p-1"
            >
              {/* Dots are the one place a full radius is allowed. */}
              <span
                className="block h-1.5 w-1.5 rounded-full transition-colors duration-100"
                style={{
                  background: isActive
                    ? "var(--color-accent)"
                    : isAnswered
                      ? "var(--color-text-muted)"
                      : "var(--color-border)",
                }}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}
