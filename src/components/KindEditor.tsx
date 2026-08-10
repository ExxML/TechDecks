'use client';

import { useState } from 'react';
import { X, Plus } from 'lucide-react';
import { Input } from './ui/Input';
import { PRESET_KINDS } from '@/lib/gemini/schema';

/**
 * Author-defined question kinds, 1–8 entries, each 1–40 characters, no
 * duplicates. These are the same constraints `RequestedKindsSchema` enforces on
 * the generate route — this editor makes them visible, the route makes them
 * binding, since a client can call that route directly.
 *
 * Kinds are free text, not a menu: a hardware problem may want "Timing" and
 * "Power". The four presets are offered as one-tap defaults because many
 * authored problems are still coding problems.
 */
export const MAX_KINDS = 8;
export const MAX_KIND_LENGTH = 40;

type Props = {
  readonly kinds: readonly string[];
  readonly onChange: (kinds: readonly string[]) => void;
};

const titleCase = (k: string) => k.charAt(0).toUpperCase() + k.slice(1);

export function KindEditor({ kinds, onChange }: Props) {
  const [draft, setDraft] = useState('');

  const isDuplicate = (candidate: string) =>
    kinds.some((k) => k.toLowerCase() === candidate.toLowerCase());

  const add = (raw: string) => {
    const value = raw.trim().slice(0, MAX_KIND_LENGTH);
    if (!value || kinds.length >= MAX_KINDS || isDuplicate(value)) return;
    onChange([...kinds, value]);
    setDraft('');
  };

  const remove = (index: number) => onChange(kinds.filter((_, i) => i !== index));

  const unusedPresets = PRESET_KINDS.filter((p) => !isDuplicate(p));
  const full = kinds.length >= MAX_KINDS;
  const draftInvalid = draft.trim().length > 0 && isDuplicate(draft.trim());

  return (
    <div>
      {kinds.length > 0 && (
        <ol className="mb-2 flex flex-col gap-1.5">
          {kinds.map((kind, i) => (
            <li
              key={`${kind}-${i}`}
              className="flex items-center gap-2 rounded-[4px] border border-[var(--color-border)] bg-[var(--color-surface-alt)] px-3 py-2"
            >
              <span className="w-4 text-[12px] leading-none text-[var(--color-text-muted)]">
                {i + 1}
              </span>
              <span className="min-w-0 flex-1 truncate text-[14px] text-[var(--color-text)]">
                {kind}
              </span>
              <button
                type="button"
                onClick={() => remove(i)}
                aria-label={`Remove ${kind}`}
                className="text-[var(--color-text-muted)] transition-colors duration-100 hover:text-[var(--color-text)]"
              >
                <X size={16} />
              </button>
            </li>
          ))}
        </ol>
      )}

      {!full && (
        <div className="flex gap-2">
          <Input
            value={draft}
            maxLength={MAX_KIND_LENGTH}
            placeholder="Add a question kind"
            aria-label="Add a question kind"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              // Enter must not submit the surrounding form — it adds a kind.
              if (e.key === 'Enter') {
                e.preventDefault();
                add(draft);
              }
            }}
          />
          <button
            type="button"
            onClick={() => add(draft)}
            disabled={!draft.trim() || draftInvalid}
            aria-label="Add kind"
            className="flex w-10 shrink-0 items-center justify-center rounded-[4px] border border-[var(--color-border)] text-[var(--color-text-muted)] transition-colors duration-100 hover:text-[var(--color-text)] disabled:opacity-40"
          >
            <Plus size={16} />
          </button>
        </div>
      )}

      {draftInvalid && (
        <p className="mt-1 text-[12px] text-[var(--color-incorrect)]">
          That kind is already in the list.
        </p>
      )}

      {!full && unusedPresets.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {unusedPresets.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => add(p)}
              className="rounded-[4px] border border-[var(--color-border)] px-1.5 py-0.5 text-[12px] leading-none text-[var(--color-text-muted)] transition-colors duration-100 hover:text-[var(--color-text)]"
            >
              + {titleCase(p)}
            </button>
          ))}
        </div>
      )}

      <p className="mt-2 text-[12px] leading-[1.5] text-[var(--color-text-muted)]">
        {kinds.length === 0
          ? 'Add at least one kind. Questions are generated in this order.'
          : `${kinds.length} of ${MAX_KINDS} · generated in this order.`}
      </p>
    </div>
  );
}
