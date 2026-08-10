import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { createClient } from '@/lib/supabase/server';
import { fetchItemBySlug, fetchFeedAnchoredAt } from '@/lib/queries';
import { ProblemFeed } from '@/components/ProblemFeed';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ slug: string }> };

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
  return { title: `${item.title} — TechDecks` };
}

/**
 * Deep link: renders the feed with that card first and continues into the
 * normal feed after it, so a bookmark or search hit does not dead-end.
 */
export default async function ProblemPage({ params }: Props) {
  const { slug } = await params;
  const db = await createClient();

  const item = await fetchItemBySlug(db, slug);
  if (!item) notFound();

  const page = await fetchFeedAnchoredAt(db, item);
  return <ProblemFeed initialItems={page.items} initialCursor={page.nextCursor} />;
}
