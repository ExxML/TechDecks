import { Suspense } from 'react';
import { createClient } from '@/lib/supabase/server';
import { fetchFeedPage } from '@/lib/queries';
import { ProblemFeed } from '@/components/ProblemFeed';
import { FeedSkeleton } from '@/components/FeedSkeleton';

/**
 * The feed is the front door — no landing page, no hero. First page is
 * server-rendered so the first card paints without a client round-trip.
 */
export const dynamic = 'force-dynamic';

export default function ProblemsPage() {
  // The Suspense boundary lives HERE rather than in a loading.tsx. A loading
  // file covers the whole /problems segment including /problems/[slug], and its
  // boundary flushes the response shell before the slug lookup resolves — which
  // downgrades a missing slug's notFound() to a soft 404 (right page, 200
  // status). Scoping it to this route keeps the skeleton without that cost.
  return (
    <Suspense fallback={<FeedSkeleton />}>
      <FeedContents />
    </Suspense>
  );
}

async function FeedContents() {
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

  return <ProblemFeed initialItems={page.items} initialCursor={page.nextCursor} origin="feed" />;
}
