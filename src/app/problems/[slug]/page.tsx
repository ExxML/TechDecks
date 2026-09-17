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
import type { FeedPage, SearchScope } from '@/lib/types';

export const dynamic = 'force-dynamic';

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
  const db = await createClient();
  const item = await fetchItemBySlug(db, slug);
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
  const query = await searchParams;
  const db = await createClient();

  const item = await fetchItemBySlug(db, slug);
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

  return (
    <ProblemFeed
      initialItems={page.items}
      initialCursor={page.nextCursor}
      // Distinct per result list, so returning to the Problems tab restores the
      // run the reader was in rather than the shuffled feed, and a different
      // search does not resume the previous one.
      origin={fromList ? `${query.from as string}:${originKey(query)}` : 'feed'}
      initialIndex={index}
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

  const { hits, total } = await searchContentItems(db, filters, SEARCH_PAGE_SIZE, 0, scope);
  let offset = 0;
  let hit = hits.findIndex((h) => h.slug === slug);
  let window = hits;

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

/** Array-valued params cannot occur here; the first value is the only one. */
function flatten(query: Record<string, string | string[] | undefined>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(query)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [k, Array.isArray(v) ? (v[0] ?? '') : (v as string)]),
  );
}

/** Identifies one result list, so two different searches never share a session. */
function originKey(query: Record<string, string | string[] | undefined>): string {
  const flat = flatten(query);
  delete flat.from;
  return new URLSearchParams(Object.entries(flat).sort()).toString();
}
