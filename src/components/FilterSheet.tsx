'use client';

import { useEffect, useState } from 'react';
import { Dialog } from './ui/Dialog';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { createClient } from '@/lib/supabase/client';
import { useUser } from '@/lib/auth';
import { fetchTagCounts } from '@/lib/queries';
import type { Difficulty, SearchFilters, SearchScope, TagCount } from '@/lib/types';

type Props = {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly filters: SearchFilters;
  /** Applying navigates; the sheet never mutates a live result list itself. */
  readonly onApply: (filters: SearchFilters) => void;
  /** The list being filtered. Only `catalog` offers the bookmarked toggle. */
  readonly scope?: SearchScope;
};

const DIFFICULTIES: readonly Difficulty[] = ['easy', 'medium', 'hard'];
const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  easy: 'Easy',
  medium: 'Medium',
  hard: 'Hard',
};

/** Cycled in order by the header toggle, so adding a mode extends the cycle. */
const TAG_SORTS = [
  {
    key: 'count',
    label: 'Count',
    /** The order the RPC already returns, so it needs no re-sort. */
    compare: null,
  },
  {
    key: 'name',
    label: 'A–Z',
    compare: (a: TagCount, b: TagCount) => a.name.localeCompare(b.name),
  },
] as const;

export function FilterSheet({ open, onClose, filters, onApply, scope = 'catalog' }: Props) {
  const { user } = useUser();
  // Edits a draft and applies on confirm, so a half-built filter set never
  // navigates. The parent remounts this on open, so `filters` seeds the draft
  // through useState rather than through an effect.
  const [draft, setDraft] = useState<SearchFilters>(filters);
  const [tags, setTags] = useState<readonly TagCount[]>([]);
  // Not persisted: reopening the sheet starts from the default sort.
  const [tagSortIndex, setTagSortIndex] = useState(0);

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

  const tagSort = TAG_SORTS[tagSortIndex];
  const sortedTags = tagSort.compare ? [...tags].sort(tagSort.compare) : tags;

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
          without a session and is hidden rather than shown returning nothing.
          On /bookmarks it is what the list already is. */}
      {user && scope === 'catalog' && (
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

      {/* Generated sets are per-user rows behind RLS, and an anonymous user's
          live in localStorage where the search cannot reach them — so this is
          hidden rather than shown matching nothing. Unlike the bookmark
          toggle it applies to every scope: no list is already only these. */}
      {user && (
        <section className="mt-4">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={draft.withMcqsOnly}
              onChange={(e) => setDraft((f) => ({ ...f, withMcqsOnly: e.target.checked }))}
              className="h-4 w-4 accent-[var(--color-accent)]"
            />
            <span className="text-[13px] text-[var(--color-text)]">Has generated MCQs</span>
          </label>
        </section>
      )}

      <section className="mt-4">
        <div className="mb-2 flex items-baseline justify-between gap-2">
          <h3 className="text-[12px] text-[var(--color-text-muted)]">
            Topics {draft.tags.length > 0 && `· ${draft.tags.length} selected`}
          </h3>
          {tags.length > 0 && (
            <button
              type="button"
              onClick={() => setTagSortIndex((i) => (i + 1) % TAG_SORTS.length)}
              className="text-[12px] text-[var(--color-text-muted)] underline underline-offset-2"
            >
              Sort by: {tagSort.label}
            </button>
          )}
        </div>
        {tags.length === 0 ? (
          <p className="text-[13px] text-[var(--color-text-muted)]">Loading topics…</p>
        ) : (
          // Tags are 175 rows. Capping them here keeps the section from
          // burying the rest of the sheet without hiding any of them.
          <div className="flex max-h-[30dvh] flex-wrap content-start gap-1.5 overflow-y-auto">
            {sortedTags.map((t) => {
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
              withMcqsOnly: false,
            }))
          }
        >
          Clear
        </Button>
      </div>
    </Dialog>
  );
}
