'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Search, SlidersHorizontal, X } from 'lucide-react';
import { CompactList } from './CompactList';
import { FilterSheet } from './FilterSheet';
import { createClient } from '@/lib/supabase/client';
import { searchContentItems, SEARCH_PAGE_SIZE } from '@/lib/queries';
import { filtersFromParams, searchHref } from '@/lib/searchParams';
import { filtersAreEmpty, type SearchFilters, type SearchPage } from '@/lib/types';

/**
 * `/search` — compact list, ordinary scrolling, no snap.
 *
 * Filters live in the URL rather than in state, so a result list is shareable
 * and the back button restores the previous query. The text box is the one
 * exception: it is a controlled input that debounces INTO the URL, because
 * pushing a route on every keystroke would spam history.
 */
export function SearchView() {
  const router = useRouter();
  const params = useSearchParams();

  // Derived from the URL during render — never synced into state by an effect.
  const filters = useMemo(() => filtersFromParams(new URLSearchParams(params.toString())), [params]);

  const [text, setText] = useState(filters.q);
  const [page, setPage] = useState<SearchPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  // The URL is the source of truth for `q`, so a back navigation that changes
  // it must win over whatever is in the box.
  const lastAppliedQuery = useRef(filters.q);
  useEffect(() => {
    if (filters.q !== lastAppliedQuery.current) {
      lastAppliedQuery.current = filters.q;
      setText(filters.q);
    }
  }, [filters.q]);

  // Debounce the box into the URL. 250ms is below the threshold where typing
  // feels laggy and well above per-keystroke.
  useEffect(() => {
    if (text === filters.q) return;
    const timer = setTimeout(() => {
      lastAppliedQuery.current = text;
      router.replace(searchHref({ ...filters, q: text }), { scroll: false });
    }, 250);
    return () => clearTimeout(timer);
  }, [text, filters, router]);

  // Runs whenever the URL-derived filters change. State is written only from
  // the promise callbacks; a synchronous reset here would cascade a render.
  useEffect(() => {
    let cancelled = false;
    void searchContentItems(createClient(), filters)
      .then((result) => {
        if (cancelled) return;
        setPage(result);
        setError(null);
      })
      .catch(() => {
        if (cancelled) return;
        setPage({ hits: [], total: 0 });
        setError('Search is unavailable right now.');
      });
    return () => {
      cancelled = true;
    };
  }, [filters]);

  const loadMore = async () => {
    if (!page || loadingMore || page.hits.length >= page.total) return;
    setLoadingMore(true);
    try {
      const next = await searchContentItems(
        createClient(),
        filters,
        SEARCH_PAGE_SIZE,
        page.hits.length,
      );
      setPage((prev) => {
        if (!prev) return next;
        // Guard against a duplicate page if two loads race.
        const seen = new Set(prev.hits.map((h) => h.id));
        return {
          hits: [...prev.hits, ...next.hits.filter((h) => !seen.has(h.id))],
          total: next.total,
        };
      });
    } catch {
      // Leave the page intact; the button stays available for a retry.
    } finally {
      setLoadingMore(false);
    }
  };

  const apply = (next: SearchFilters) => {
    lastAppliedQuery.current = next.q;
    router.replace(searchHref(next), { scroll: false });
  };

  const activeFilterCount =
    filters.difficulties.length +
    filters.tags.length +
    (filters.acMin !== null ? 1 : 0) +
    (filters.acMax !== null ? 1 : 0) +
    (filters.bookmarkedOnly ? 1 : 0);

  const hits = page?.hits ?? [];
  const showEmpty = page !== null && hits.length === 0;

  return (
    <div className="flex h-[calc(100dvh-48px)] flex-col">
      <div className="flex items-center gap-2 border-b border-[var(--color-border)] px-4 py-3">
        <div className="relative flex min-w-0 flex-1 items-center">
          <Search
            size={16}
            aria-hidden="true"
            className="pointer-events-none absolute left-2.5 text-[var(--color-text-muted)]"
          />
          <input
            type="search"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Search problems"
            aria-label="Search problems"
            className="w-full rounded-[4px] border border-[var(--color-border)] bg-[var(--color-surface-alt)] py-2 pr-8 pl-8 text-[14px] text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-accent)] focus:outline-none"
          />
          {text && (
            <button
              type="button"
              onClick={() => setText('')}
              aria-label="Clear search"
              className="absolute right-2 text-[var(--color-text-muted)] transition-colors duration-100 hover:text-[var(--color-text)]"
            >
              <X size={16} />
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={() => setShowFilters(true)}
          aria-label="Filters"
          className="relative flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[4px] border transition-colors duration-100"
          style={{
            borderColor: activeFilterCount > 0 ? 'var(--color-accent)' : 'var(--color-border)',
            color: activeFilterCount > 0 ? 'var(--color-accent)' : 'var(--color-text-muted)',
          }}
        >
          <SlidersHorizontal size={16} />
          {activeFilterCount > 0 && (
            <span className="absolute -top-1.5 -right-1.5 flex h-4 min-w-4 items-center justify-center rounded-[4px] bg-[var(--color-accent)] px-1 text-[10px] leading-none text-[#1a1a1a]">
              {activeFilterCount}
            </span>
          )}
        </button>
      </div>

      {page !== null && hits.length > 0 && (
        <p className="border-b border-[var(--color-border)] px-4 py-1.5 text-[12px] leading-none text-[var(--color-text-muted)]">
          {page.total} result{page.total === 1 ? '' : 's'}
        </p>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {error && <p className="px-4 py-3 text-[13px] text-[var(--color-incorrect)]">{error}</p>}

        {showEmpty && !error ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6">
            <p className="text-center text-[14px] text-[var(--color-text-muted)]">
              {filtersAreEmpty(filters) ? 'Search the problem catalog.' : 'No problems match'}
            </p>
            {!filtersAreEmpty(filters) && (
              <button
                type="button"
                onClick={() => {
                  setText('');
                  router.replace('/search', { scroll: false });
                }}
                className="text-[13px] text-[var(--color-accent)] underline underline-offset-2"
              >
                Clear filters
              </button>
            )}
          </div>
        ) : (
          <>
            <CompactList items={hits} emptyMessage="" scrollable={false} />
            {page !== null && hits.length < page.total && (
              <div className="flex justify-center py-4">
                <button
                  type="button"
                  onClick={() => void loadMore()}
                  disabled={loadingMore}
                  className="text-[13px] text-[var(--color-text-muted)] underline underline-offset-2 disabled:opacity-50"
                >
                  {loadingMore ? 'Loading…' : `Show more (${page.total - hits.length} left)`}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Keyed so the sheet mounts a fresh draft seeded from these filters,
          rather than syncing one in via an effect. */}
      <FilterSheet
        key={params.toString()}
        open={showFilters}
        onClose={() => setShowFilters(false)}
        filters={filters}
        onApply={apply}
      />
    </div>
  );
}
