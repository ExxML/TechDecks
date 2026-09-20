import { cache, Suspense } from 'react';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { createClient } from '@/lib/supabase/server';
import {
  fetchItemBySlug,
  fetchItemsBySlugs,
  fetchFeedAnchoredAt,
  SEARCH_PAGE_SIZE,
  searchContentItems,
} from '@/lib/queries';
import { filtersFromParams, paramsFromFilters } from '@/lib/searchParams';
import { pageTitle } from '@/lib/title';
import { ProblemFeed } from '@/components/ProblemFeed';
import { FeedSkeleton } from '@/components/FeedSkeleton';
import type { FeedPage, SearchScope } from '@/lib/types';

export const dynamic = 'force-dynamic';

/**
 * The slug row, fetched once per request.
 *
 * generateMetadata and the page body both need it, and both run for every
 * navigation — without memoising, opening a card paid for the same row twice,
 * serially, before anything could render.
 */
const itemBySlug = cache(async (slug: string) => {
  const db = await createClient();
  return fetchItemBySlug(db, slug);
});

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** `?from=` — which result list a hit was opened from, and the scope to re-run
 *  it under. Absent or unrecognised means the ordinary shuffled feed. */
const FROM_SCOPE: Record<string, SearchScope> = {
  search: 'catalog',
  bookmarks: 'bookmarks',
  history: 'history',
};

/**
 * `notFound()` here rather than only in the page component.
 *
 * generateMetadata runs BEFORE the page and its result is flushed into the
 * response head; by the time the page body called notFound(), the status line
 * had already gone out as 200, producing a soft 404 — the right page under the
 * wrong status, which crawlers and caches treat as a real page. Raising it at
 * the first place the miss is known is what makes the 404 status real.
 */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const item = await itemBySlug(slug);
  if (!item) notFound();
  return { title: pageTitle(item.title) };
}

/**
 * Deep link: renders the feed with that card first and continues into the
 * normal feed after it, so a bookmark or search hit does not dead-end.
 *
 * Opened from a result list (`?from=` plus that list's own filter params), the
 * feed pages through the results in the order they were listed instead — the
 * reader chose that order, and the shuffled catalog is not it.
 */
export default async function ProblemPage({ params, searchParams }: Props) {
  const { slug } = await params;

  // Awaited here, outside the boundary below, so a missing slug still raises
  // before anything streams — a notFound() behind a Suspense fallback would
  // have already sent a 200. The row is the memoised one generateMetadata
  // fetched, so this costs no second query.
  if (!(await itemBySlug(slug))) notFound();

  return (
    <Suspense fallback={<FeedSkeleton />}>
      <AnchoredFeed slug={slug} searchParams={searchParams} />
    </Suspense>
  );
}

/**
 * The deck this card sits in.
 *
 * Split from the route so the card frame paints while the surrounding list is
 * still being assembled: opening a hit deep in a result list re-runs the search
 * to find it, and that is long enough to look like a dropped tap.
 */
async function AnchoredFeed({
  slug,
  searchParams,
}: {
  slug: string;
  searchParams: Props['searchParams'];
}) {
  const query = await searchParams;
  const db = await createClient();

  const item = await itemBySlug(slug);
  if (!item) notFound();

  const from = typeof query.from === 'string' ? FROM_SCOPE[query.from] : undefined;

  let page: FeedPage;
  let index = 0;
  const fromList = from ? await searchOrder(db, query, slug, from) : null;

  if (fromList) {
    ({ page, index } = fromList);
  } else {
    page = await fetchFeedAnchoredAt(db, item);
  }

  // The result list this run belongs to, normalised so a reload, a shared link
  // and a differently ordered query all resolve to the same list.
  const key = fromList ? originKey(query) : null;
  const listQuery =
    key === null
      ? undefined
      : new URLSearchParams([
          ['from', query.from as string],
          ...new URLSearchParams(key),
        ]).toString();

  return (
    <ProblemFeed
      initialItems={page.items}
      initialCursor={page.nextCursor}
      // Distinct per result list, so returning to the Problems tab restores the
      // run the reader was in rather than the shuffled feed, and a different
      // search does not resume the previous one.
      origin={key === null ? 'feed' : `${query.from as string}:${key}`}
      initialIndex={index}
      listQuery={listQuery}
    />
  );
}

/**
 * The search results as a feed, positioned at the hit that was tapped.
 *
 * Re-run server-side from the same URL params the result list was built from,
 * so the order is the one the reader saw. Null when the slug is not in the
 * results at all — a stale link, which falls back to the ordinary anchored feed
 * rather than dropping the reader somewhere unrelated.
 *
 * Only the page the hit falls in is dealt: the reader may have scrolled deep
 * into a long list, and the feed pages on from there through the rest of it.
 */
async function searchOrder(
  db: Awaited<ReturnType<typeof createClient>>,
  query: Record<string, string | string[] | undefined>,
  slug: string,
  scope: SearchScope,
): Promise<{ page: FeedPage; index: number } | null> {
  const params = paramsFromFilters(filtersFromParams(new URLSearchParams(flatten(query))));
  const filters = filtersFromParams(params);

  // `?i=` is the row's own position in the list it was tapped in, so the page
  // holding it is known without looking. Only a hint: a shared or reloaded link
  // may have been written against a list that has since moved, so the slug is
  // checked for and the walk below still runs when it is not there.
  //
  // The first page is fetched alongside it rather than after it, so a hint that
  // misses costs no more than having sent none — the walk it falls back to
  // starts there either way.
  const hinted = Number(query.i);
  const hintedOffset =
    Number.isInteger(hinted) && hinted >= SEARCH_PAGE_SIZE
      ? Math.floor(hinted / SEARCH_PAGE_SIZE) * SEARCH_PAGE_SIZE
      : 0;

  const [first, guess] = await Promise.all([
    searchContentItems(db, filters, SEARCH_PAGE_SIZE, 0, scope),
    hintedOffset > 0
      ? searchContentItems(db, filters, SEARCH_PAGE_SIZE, hintedOffset, scope)
      : null,
  ]);

  let offset = 0;
  let { hits: window, total } = first;
  let hit = window.findIndex((h) => h.slug === slug);

  if (hit === -1 && guess) {
    const found = guess.hits.findIndex((h) => h.slug === slug);
    if (found !== -1) {
      offset = hintedOffset;
      window = guess.hits;
      total = guess.total;
      hit = found;
    }
  }

  // The list pages as it scrolls, so the hit is not necessarily in its first
  // page. Walk forward to the page holding it.
  while (hit === -1 && offset + window.length < total && window.length > 0) {
    offset += window.length;
    ({ hits: window } = await searchContentItems(db, filters, SEARCH_PAGE_SIZE, offset, scope));
    hit = window.findIndex((h) => h.slug === slug);
  }
  if (hit === -1) return null;

  // The hits carry no body, so the rows are re-read in full — in the hit order.
  const items = await fetchItemsBySlugs(db, window.map((h) => h.slug));
  const index = items.findIndex((i) => i.slug === slug);
  if (index === -1) return null;

  const next = offset + window.length;
  // A result list is a closed set: it ends where the search ends rather than
  // running on into the catalog, which is the whole point of paging through it.
  return {
    page: {
      items,
      nextCursor:
        next < total ? { kind: 'search', scope, params: params.toString(), offset: next } : null,
    },
    index,
  };
}

/**
 * Params that name the list itself, rather than the way into it.
 *
 * `from` names the list and `i` names one row of it, so neither belongs to the
 * list's identity — every row of one list must open the same run, or the feed
 * session would be keyed per row and never restore. Dropped here, once, so
 * anything derived from the query inherits that.
 *
 * Array-valued params cannot occur here; the first value is the only one.
 */
function flatten(query: Record<string, string | string[] | undefined>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(query)
      .filter(([k, v]) => v !== undefined && k !== 'from' && k !== 'i')
      .map(([k, v]) => [k, Array.isArray(v) ? (v[0] ?? '') : (v as string)]),
  );
}

/** Identifies one result list, so two different searches never share a session. */
function originKey(query: Record<string, string | string[] | undefined>): string {
  return new URLSearchParams(Object.entries(flatten(query)).sort()).toString();
}
