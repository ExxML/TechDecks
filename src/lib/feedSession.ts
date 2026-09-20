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

/** `/problems` as the reader left it, or the bare route when untouched. */
export function feedHref(): string {
  return href;
}

/** The stored session when it came from `origin`, otherwise null. */
export function takeFeedSession(origin: string): FeedSession | null {
  return session?.origin === origin ? session : null;
}

export function clearFeedSession(): void {
  session = null;
  href = '/problems';
}
