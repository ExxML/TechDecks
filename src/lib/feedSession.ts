'use client';

import type { ContentItem, FeedCursor } from './types';

/**
 * Where the feed was when the reader last left it, for the length of one tab
 * session.
 *
 * The tab bar navigates to `/problems`, and the feed rewrites the URL to
 * `/problems/[slug]` as it pages — so returning to the tab re-renders the route
 * from its server-fetched first page and lands on whatever card that page
 * started with. This module is what carries the position across, and it holds
 * the items too: re-deriving them would deal a fresh shuffle and the reader's
 * place in it would mean nothing.
 *
 * Deliberately module state rather than sessionStorage. It is scoped to the
 * loaded app: a refresh starts over from the route's own server-fetched page.
 */

export type FeedSession = {
  readonly items: readonly ContentItem[];
  readonly cursor: FeedCursor | null;
  readonly index: number;
  /**
   * What produced this list. A session is restored only onto the route that
   * would otherwise render the same thing: `feed` for the shuffled feed, and
   * `<list>:<key>` for one entered from a result list, keyed by that list's
   * own filters so two different searches never share a session.
   */
  readonly origin: string;
};

let session: FeedSession | null = null;

/**
 * The route the feed was last showing, for the tab bar to return to.
 *
 * `/problems` renders the shuffled feed, so a session entered from a result
 * list could never be restored through that bare href — its origin would not
 * match. The feed already rewrites the URL to the card it is on, filters and
 * all; keeping that href is what lets the tab lead back into the same run.
 */
let href = '/problems';

export function saveFeedSession(next: FeedSession, at: string): void {
  session = next;
  href = at;
}

/**
 * Where the Problems tab leads.
 *
 * A live session is a complete feed — items, cursor and position — and
 * `ProblemFeed` prefers it over anything the route fetches. Returning through
 * the slug href would make `/problems/[slug]` re-derive that list server-side
 * only for the restore to discard it, so the tab goes to the static shell and
 * the feed rewrites the URL back to the card it lands on.
 *
 * Without a session there is nothing to restore, and the slug href is what
 * carries the reader back to where they were.
 */
export function feedHref(): string {
  return session ? '/problems' : href;
}

/**
 * The run `/problems` would restore, or null when there is nothing to restore.
 *
 * The list query is read back off the saved href rather than stored beside it:
 * the feed writes that href from the same query it was given, so the two cannot
 * drift apart. Restoring it is what keeps a run entered from a result list
 * paging through that list instead of the shuffled catalog.
 */
export function restorableRun(): { origin: string; listQuery?: string } | null {
  if (!session) return null;
  const query = href.slice(href.indexOf('?') + 1);
  return {
    origin: session.origin,
    listQuery: href.includes('?') && query ? query : undefined,
  };
}

/** The stored session when it came from `origin`, otherwise null. */
export function takeFeedSession(origin: string): FeedSession | null {
  return session?.origin === origin ? session : null;
}

export function clearFeedSession(): void {
  session = null;
  href = '/problems';
}
