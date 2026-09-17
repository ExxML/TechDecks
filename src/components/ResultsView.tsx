'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Search, SlidersHorizontal, X } from 'lucide-react';
import { CompactList } from './CompactList';
import { CompactListSkeleton } from './CompactListSkeleton';
import { FilterSheet } from './FilterSheet';
import { createClient } from '@/lib/supabase/client';
import { cachedSearchPage, searchContentItems, SEARCH_PAGE_SIZE } from '@/lib/queries';
import { filtersFromParams, paramsFromFilters, searchHref } from '@/lib/searchParams';
import {
  filtersAreEmpty,
  type SearchFilters,
  type SearchHit,
  type SearchPage,
  type SearchScope,
} from '@/lib/types';

type Props = {
  /** Which list to search. Fixed by the route, never chosen in the sheet. */
  readonly scope: SearchScope;
  /** This list's route, which its filters are written back into. */
  readonly basePath: string;
  /** `?from=` on each row's href, so the feed re-runs this same list. */
  readonly from: string;
  /** Shown when the list itself is empty, before any filter narrows it. */
  readonly emptyMessage: string;
  /** Rendered at the right of each row. `drop` removes the row from the
   *  rendered page, for an action that takes it off this list. */
  readonly renderAction?: (hit: SearchHit, drop: () => void) => React.ReactNode;
};

/**
 * A filterable result list: `/search`, `/bookmarks`, `/history`.
 *
 * All three are one ranked search over a different row set, so they share this
 * view rather than each growing their own box, sheet and paging. `scope` is
 * what narrows the query; everything else about the three is identical.
 *
 * Filters live in the URL rather than in state, so a result list is shareable
 * and the back button restores the previous query. The text box is the one
 * exception: it is a controlled input that debounces INTO the URL, because
 * pushing a route on every keystroke would spam history.
 */
export function ResultsView({ scope, basePath, from, emptyMessage, renderAction }: Props) {
  const router = useRouter();
  const params = useSearchParams();

  // Derived from the URL during render — never synced into state by an effect.
  const filters = useMemo(() => filtersFromParams(new URLSearchParams(params.toString())), [params]);

  const [text, setText] = useState(filters.q);
  // Held with the query it came from, so a result is never shown under filters
  // it does not answer — the fetch below is in flight while they differ.
  const [fetched, setFetched] = useState<{
    readonly page: SearchPage;
    readonly filters: SearchFilters;
    readonly scope: SearchScope;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);

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
      router.replace(searchHref({ ...filters, q: text }, basePath), { scroll: false });
    }, 250);
    return () => clearTimeout(timer);
  }, [text, filters, router, basePath]);

  // Runs whenever the URL-derived filters change. State is written only from
  // the promise callbacks; a synchronous reset here would cascade a render.
  useEffect(() => {
    let cancelled = false;
    void searchContentItems(createClient(), filters, SEARCH_PAGE_SIZE, 0, scope)
      .then((result) => {
        if (cancelled) return;
        setFetched({ page: result, filters, scope });
        setError(null);
      })
      .catch(() => {
        if (cancelled) return;
        setFetched({ page: { hits: [], total: 0 }, filters, scope });
        setError('Search is unavailable right now.');
      });
    return () => {
      cancelled = true;
    };
  }, [filters, scope]);

  // This query's own result once it lands, and until then whatever it last
  // returned — which is what lets a revisited list paint before the refetch.
  const page =
    fetched !== null && fetched.filters === filters && fetched.scope === scope
      ? fetched.page
      : cachedSearchPage(filters, scope);

  const hits = page?.hits ?? [];
  const showEmpty = page !== null && hits.length === 0;
  const remaining = page === null ? 0 : page.total - hits.length;

  // The observer fires again while the sentinel is still in view after a page
  // lands, so the in-flight guard has to be readable synchronously.
  const loadingMore = useRef(false);
  const loadMore = async () => {
    if (page === null || loadingMore.current || page.hits.length >= page.total) return;
    loadingMore.current = true;
    try {
      const next = await searchContentItems(
        createClient(),
        filters,
        SEARCH_PAGE_SIZE,
        page.hits.length,
        scope,
      );
      // Guard against a duplicate page if two loads race.
      const seen = new Set(page.hits.map((h) => h.id));
      setFetched({
        page: {
          hits: [...page.hits, ...next.hits.filter((h) => !seen.has(h.id))],
          total: next.total,
        },
        filters,
        scope,
      });
    } catch {
      // Leave the page intact; scrolling past the sentinel retries.
    } finally {
      loadingMore.current = false;
    }
  };

  const scroller = useRef<HTMLDivElement | null>(null);
  const sentinel = useRef<HTMLDivElement | null>(null);

  // Pages in as the trailing skeleton nears the bottom of the scroller. A
  // viewport of lead time keeps an ordinary scroll from ever reaching the end
  // first; a fast flick can still outrun it and wait on the fetch.
  //
  // Re-observed after each page lands, so a sentinel still in view keeps
  // paging, and torn down with the sentinel once the list is exhausted.
  useEffect(() => {
    const node = sentinel.current;
    if (node === null) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) void loadMore();
      },
      { root: scroller.current, rootMargin: '400px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
    // `loadMore` is recreated every render; the page it closes over is what
    // this depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  const apply = (next: SearchFilters) => {
    lastAppliedQuery.current = next.q;
    router.replace(searchHref(next, basePath), { scroll: false });
  };

  /** Drops a row from the rendered page, for an action that unlists it. */
  const drop = (id: string) => {
    if (page === null) return;
    setFetched({
      page: { hits: page.hits.filter((h) => h.id !== id), total: Math.max(0, page.total - 1) },
      filters,
      scope,
    });
  };

  const activeFilterCount =
    filters.difficulties.length +
    filters.tags.length +
    (filters.acMin !== null ? 1 : 0) +
    (filters.acMax !== null ? 1 : 0) +
    // Already implied by the scope, so it is not a filter the reader applied.
    (filters.bookmarkedOnly && scope === 'catalog' ? 1 : 0);

  // Carried into the feed so it pages through these results in this order. The
  // filters travel rather than the ids: the feed re-runs the same search
  // server-side, which is one short URL instead of a list of thirty slugs.
  const hitHref = useMemo(() => {
    const p = paramsFromFilters(filters);
    p.set('from', from);
    return `?${p.toString()}`;
  }, [filters, from]);

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
            <span className="absolute -top-1.5 -right-1.5 flex h-4 min-w-4 items-center justify-center rounded-[4px] bg-[var(--color-accent)] px-1 text-[10px] leading-none text-[var(--color-on-accent)]">
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

      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
        {error && <p className="px-4 py-3 text-[13px] text-[var(--color-incorrect)]">{error}</p>}

        {page === null && !error ? (
          <CompactListSkeleton />
        ) : showEmpty && !error ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6">
            <p className="text-center text-[14px] text-[var(--color-text-muted)]">
              {filtersAreEmpty(filters) ? emptyMessage : 'No problems match'}
            </p>
            {!filtersAreEmpty(filters) && (
              <button
                type="button"
                onClick={() => {
                  setText('');
                  router.replace(basePath, { scroll: false });
                }}
                className="text-[13px] text-[var(--color-accent)] underline underline-offset-2"
              >
                Clear filters
              </button>
            )}
          </div>
        ) : (
          <>
            <CompactList<SearchHit>
              items={hits}
              emptyMessage=""
              scrollable={false}
              hrefSuffix={hitHref}
              renderAction={renderAction && ((hit) => renderAction(hit, () => drop(hit.id)))}
            />
            {remaining > 0 && (
              <div ref={sentinel}>
                <CompactListSkeleton rows={Math.min(3, remaining)} />
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
        scope={scope}
      />
    </div>
  );
}
