import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { createClient } from '@/lib/supabase/server';
import { fetchItemBySlug, fetchFeedAnchoredAt } from '@/lib/queries';
import { ProblemFeed } from '@/components/ProblemFeed';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const db = await createClient();
  const item = await fetchItemBySlug(db, slug);
  return { title: item ? `${item.title} — TechDeck` : 'TechDeck' };
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
