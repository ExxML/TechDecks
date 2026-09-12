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
 * Deliberately module state rather than sessionStorage. It should survive a tab
 * switch, not a refresh — a refresh is the gesture that asks for a new deal.
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

export function saveFeedSession(next: FeedSession): void {
  session = next;
}

/** The stored session when it came from `origin`, otherwise null. */
export function takeFeedSession(origin: string): FeedSession | null {
  return session?.origin === origin ? session : null;
}

export function clearFeedSession(): void {
  session = null;
}
