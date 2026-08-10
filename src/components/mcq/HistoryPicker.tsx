'use client';

import { Dialog } from '../ui/Dialog';
import { Trash2 } from 'lucide-react';
import type { McqSet } from '@/lib/mcq/store';

type Props = {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly sets: readonly McqSet[];
  readonly activeSetId: string | null;
  readonly onSelect: (setId: string) => void;
  readonly onDelete: (setId: string) => void;
  readonly onRegenerate: () => void;
};

function relativeTime(iso: string): string {
  const diff = Date.now() - Date.parse(iso);
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function scoreLabel(set: McqSet): string {
  const answered = set.answers.filter((a) => a !== null);
  if (answered.length === 0) return 'Not started';
  const correct = answered.filter((a) => a?.correct).length;
  if (answered.length < set.questions.length) {
    return `${correct}/${set.questions.length} · ${answered.length} answered`;
  }
  return `${correct}/${set.questions.length}`;
}

/**
 * The 5-set history sheet.
 *
 * Includes a delete affordance because the trim trigger otherwise evicts the
 * oldest set silently, with no user control over which one goes.
 */
export function HistoryPicker({
  open,
  onClose,
  sets,
  activeSetId,
  onSelect,
  onDelete,
  onRegenerate,
}: Props) {
  return (
    <Dialog open={open} onClose={onClose} title={`${sets.length} set${sets.length === 1 ? '' : 's'}`}>
      <ul className="flex flex-col gap-1.5">
        {sets.map((set) => {
          const active = set.id === activeSetId;
          return (
            <li key={set.id} className="flex items-stretch gap-1.5">
              <button
                type="button"
                onClick={() => {
                  onSelect(set.id);
                  onClose();
                }}
                className="flex-1 rounded-[4px] border px-3 py-2 text-left transition-colors duration-100"
                style={{
                  borderColor: active ? 'var(--color-accent)' : 'var(--color-border)',
                  background: 'var(--color-surface-alt)',
                }}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[13px] text-[var(--color-text)]">{scoreLabel(set)}</span>
                  <span className="text-[12px] text-[var(--color-text-muted)]">
                    {relativeTime(set.generated_at)}
                  </span>
                </div>
                <p className="mt-0.5 truncate text-[12px] text-[var(--color-text-muted)]">
                  {set.model.replace(/^models\//, '')} · {set.language}
                </p>
              </button>
              <button
                type="button"
                onClick={() => onDelete(set.id)}
                aria-label="Delete this set"
                className="rounded-[4px] border border-[var(--color-border)] px-2 text-[var(--color-text-muted)] transition-colors duration-100 hover:text-[var(--color-incorrect)]"
              >
                <Trash2 size={16} />
              </button>
            </li>
          );
        })}
      </ul>

      <button
        type="button"
        onClick={() => {
          onClose();
          onRegenerate();
        }}
        className="mt-3 text-[13px] text-[var(--color-accent)] underline underline-offset-2"
      >
        Regenerate
      </button>
    </Dialog>
  );
}
