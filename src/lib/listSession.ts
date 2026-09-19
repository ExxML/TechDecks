'use client';

/**
 * The filters each result list was last showing, for the length of one tab
 * session.
 *
 * Filters live in the URL (see `searchParams`), but the tab bar links to the
 * bare route — so leaving `/search` and tapping back into it would otherwise
 * land on a filter-free URL and drop the reader's query. This module is what
 * carries the params across, keyed by route so `/search`, `/bookmarks` and
 * `/history` each keep their own.
 *
 * Deliberately module state rather than sessionStorage, matching the feed: it
 * is scoped to the loaded app, and a refresh starts over from a bare list.
 */

const queries = new Map<string, string>();

/** Records `basePath`'s current query string. Empty clears it. */
export function saveListQuery(basePath: string, query: string): void {
  if (query) queries.set(basePath, query);
  else queries.delete(basePath);
}

/** `basePath` with its remembered filters, or the bare path when it has none. */
export function listHref(basePath: string): string {
  const query = queries.get(basePath);
  return query ? `${basePath}?${query}` : basePath;
}
