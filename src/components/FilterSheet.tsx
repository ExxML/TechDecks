'use client';

import { useEffect, useState } from 'react';
import { Dialog } from './ui/Dialog';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { createClient } from '@/lib/supabase/client';
import { useUser } from '@/lib/auth';
import { fetchTagCounts } from '@/lib/queries';
import type { Difficulty, SearchFilters, TagCount } from '@/lib/types';

type Props = {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly filters: SearchFilters;
  /** Applying navigates; the sheet never mutates a live result list itself. */
  readonly onApply: (filters: SearchFilters) => void;
};

const DIFFICULTIES: readonly Difficulty[] = ['easy', 'medium', 'hard'];
const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  easy: 'Easy',
  medium: 'Medium',
  hard: 'Hard',
};

/** Tags are 175 rows; showing all of them buries the rest of the sheet. */
const TAG_LIMIT = 24;

export function FilterSheet({ open, onClose, filters, onApply }: Props) {
  const { user } = useUser();
  // Edits a draft and applies on confirm, so a half-built filter set never
  // navigates. The parent remounts this on open, so `filters` seeds the draft
  // through useState rather than through an effect.
  const [draft, setDraft] = useState<SearchFilters>(filters);
  const [tags, setTags] = useState<readonly TagCount[]>([]);
  const [showAllTags, setShowAllTags] = useState(false);

  useEffect(() => {
    if (!open || tags.length > 0) return;
    let cancelled = false;
    void fetchTagCounts(createClient())
      .then((rows) => {
        if (!cancelled) setTags(rows);
      })
      .catch(() => {
        if (!cancelled) setTags([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, tags.length]);

  const toggleDifficulty = (d: Difficulty) =>
    setDraft((f) => ({
      ...f,
      difficulties: f.difficulties.includes(d)
        ? f.difficulties.filter((x) => x !== d)
        : [...f.difficulties, d],
    }));

  const toggleTag = (slug: string) =>
    setDraft((f) => ({
      ...f,
      tags: f.tags.includes(slug) ? f.tags.filter((x) => x !== slug) : [...f.tags, slug],
    }));

  const setPercent = (key: 'acMin' | 'acMax', raw: string) => {
    const n = Number(raw);
    setDraft((f) => ({
      ...f,
      [key]: raw.trim() === '' || !Number.isFinite(n) ? null : Math.min(Math.max(n, 0), 100),
    }));
  };

  // Selected tags always render, even past the limit — otherwise a tag chosen
  // from a previous search would vanish from the sheet that set it.
  const visibleTags = showAllTags
    ? tags
    : tags.filter((t, i) => i < TAG_LIMIT || draft.tags.includes(t.slug));

  return (
    <Dialog open={open} onClose={onClose} title="Filters">
      <section>
        <h3 className="mb-2 text-[12px] text-[var(--color-text-muted)]">Difficulty</h3>
        <div className="flex gap-2">
          {DIFFICULTIES.map((d) => {
            const on = draft.difficulties.includes(d);
            return (
              <button
                key={d}
                type="button"
                aria-pressed={on}
                onClick={() => toggleDifficulty(d)}
                className="flex-1 rounded-[4px] border px-3 py-2 text-[13px] leading-none transition-colors duration-100"
                style={{
                  borderColor: on ? 'var(--color-accent)' : 'var(--color-border)',
                  color: on ? 'var(--color-accent)' : 'var(--color-text-muted)',
                }}
              >
                {DIFFICULTY_LABEL[d]}
              </button>
            );
          })}
        </div>
      </section>

      <section className="mt-4">
        <h3 className="mb-2 text-[12px] text-[var(--color-text-muted)]">
          Acceptance rate (%)
        </h3>
        <div className="flex items-center gap-2">
          <Input
            type="number"
            min={0}
            max={100}
            inputMode="numeric"
            aria-label="Minimum acceptance rate"
            placeholder="Min"
            value={draft.acMin ?? ''}
            onChange={(e) => setPercent('acMin', e.target.value)}
          />
          <span className="text-[13px] text-[var(--color-text-muted)]">to</span>
          <Input
            type="number"
            min={0}
            max={100}
            inputMode="numeric"
            aria-label="Maximum acceptance rate"
            placeholder="Max"
            value={draft.acMax ?? ''}
            onChange={(e) => setPercent('acMax', e.target.value)}
          />
        </div>
      </section>

      {/* Bookmarks are per-user rows behind RLS, so this filter is meaningless
          without a session and is hidden rather than shown returning nothing. */}
      {user && (
        <section className="mt-4">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={draft.bookmarkedOnly}
              onChange={(e) => setDraft((f) => ({ ...f, bookmarkedOnly: e.target.checked }))}
              className="h-4 w-4 accent-[var(--color-accent)]"
            />
            <span className="text-[13px] text-[var(--color-text)]">Bookmarked only</span>
          </label>
        </section>
      )}

      <section className="mt-4">
        <h3 className="mb-2 text-[12px] text-[var(--color-text-muted)]">
          Topics {draft.tags.length > 0 && `· ${draft.tags.length} selected`}
        </h3>
        {tags.length === 0 ? (
          <p className="text-[13px] text-[var(--color-text-muted)]">Loading topics…</p>
        ) : (
          <>
            <div className="flex flex-wrap gap-1.5">
              {visibleTags.map((t) => {
                const on = draft.tags.includes(t.slug);
                return (
                  <button
                    key={t.slug}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleTag(t.slug)}
                    className="rounded-[4px] border px-1.5 py-0.5 text-[12px] leading-none transition-colors duration-100"
                    style={{
                      borderColor: on ? 'var(--color-accent)' : 'var(--color-border)',
                      color: on ? 'var(--color-accent)' : 'var(--color-text-muted)',
                    }}
                  >
                    {t.name}
                    <span className="ml-1 opacity-60">{t.count}</span>
                  </button>
                );
              })}
            </div>
            {!showAllTags && tags.length > visibleTags.length && (
              <button
                type="button"
                onClick={() => setShowAllTags(true)}
                className="mt-2 text-[12px] text-[var(--color-text-muted)] underline underline-offset-2"
              >
                Show all {tags.length} topics
              </button>
            )}
          </>
        )}
      </section>

      <div className="mt-5 flex gap-2">
        <Button
          variant="primary"
          className="flex-1"
          onClick={() => {
            onApply(draft);
            onClose();
          }}
        >
          Apply
        </Button>
        <Button
          variant="secondary"
          onClick={() =>
            setDraft((f) => ({
              // The text query is not a filter and survives a filter clear —
              // wiping it would make "Clear" read as "start over".
              ...f,
              difficulties: [],
              tags: [],
              acMin: null,
              acMax: null,
              bookmarkedOnly: false,
            }))
          }
        >
          Clear
        </Button>
      </div>
    </Dialog>
  );
}
