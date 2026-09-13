import { ProblemFeed } from '@/components/ProblemFeed';

/**
 * The feed is the front door — no landing page, no hero.
 *
 * Prerendered as a static shell. The deck itself is dealt by ProblemFeed,
 * which restores the one this tab was already reading when there is one: a
 * server-rendered first page would be discarded in that case, and the tab bar
 * returns here often enough that waiting on it was the visible cost. Nothing
 * here is indexable — /problems/[slug] is the shareable route, and it keeps
 * its own metadata and 404.
 */
export default function ProblemsPage() {
  return <ProblemFeed origin="feed" />;
}
