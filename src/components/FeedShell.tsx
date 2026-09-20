'use client';

import { useState } from 'react';
import { ProblemFeed } from './ProblemFeed';
import { restorableRun } from '@/lib/feedSession';

/**
 * `/problems` as the tab bar re-enters it.
 *
 * The shell has no slug of its own, so the run it should open is whichever one
 * is still in memory — a shuffled feed, or one entered from a result list and
 * keyed by that list's filters. Resolving it here lets the restore happen on
 * the client, with no server page to wait on; `ProblemFeed` rewrites the URL to
 * the card it lands on, so the reader arrives back at the address they left.
 * Falls back to the shuffled feed when nothing is stored.
 *
 * Read once, at mount, for the same reason the session itself is: a later read
 * would reopen whatever the feed has since paged to.
 */
export function FeedShell() {
  const [run] = useState(restorableRun);
  return <ProblemFeed origin={run?.origin ?? 'feed'} listQuery={run?.listQuery} />;
}
