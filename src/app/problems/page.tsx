import { createClient } from '@/lib/supabase/server';
import { fetchFeedPage } from '@/lib/queries';
import { ProblemFeed } from '@/components/ProblemFeed';

/**
 * The feed is the front door — no landing page, no hero. First page is
 * server-rendered so the first card paints without a client round-trip.
 */
export const dynamic = 'force-dynamic';

export default async function ProblemsPage() {
  const db = await createClient();
  const page = await fetchFeedPage(db, null);

  if (page.items.length === 0) {
    return (
      <div className="flex h-[calc(100dvh-48px)] items-center justify-center px-6">
        <p className="text-center text-[14px] text-[var(--color-text-muted)]">
          No problems yet. Run the seed to load the catalog.
        </p>
      </div>
    );
  }

  return <ProblemFeed initialItems={page.items} initialCursor={page.nextCursor} />;
}
