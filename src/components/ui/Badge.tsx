import type { ReactNode } from 'react';
import type { Difficulty } from '@/lib/types';

type Props = {
  readonly children: ReactNode;
  readonly className?: string;
};

/** Muted, bordered, 12px. No pill shapes — 4px radius like everything else. */
export function Badge({ children, className = '' }: Props) {
  return (
    <span
      className={
        'inline-flex items-center rounded-[4px] px-1.5 py-0.5 text-[12px] leading-none ' +
        `${className}`
      }
    >
      {children}
    </span>
  );
}

const DIFFICULTY_COLOR: Record<Difficulty, string> = {
  easy: 'var(--color-easy)',
  medium: 'var(--color-medium)',
  hard: 'var(--color-hard)',
};

const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  easy: 'Easy',
  medium: 'Medium',
  hard: 'Hard',
};

/**
 * Difficulty is colour-coded, but never colour-ALONE: the word is always
 * present, so it survives colour blindness and greyscale.
 */
export function DifficultyBadge({ difficulty }: { readonly difficulty: Difficulty | null }) {
  if (!difficulty) return null;
  return (
    <span
      className="text-[12px] leading-tight font-medium"
      style={{ color: DIFFICULTY_COLOR[difficulty] }}
    >
      {DIFFICULTY_LABEL[difficulty]}
    </span>
  );
}
