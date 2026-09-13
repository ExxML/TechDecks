import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { fetchFeedPage } from '@/lib/queries';

/**
 * Keyset-paginated feed pages for the client's infinite scroll.
 *
 * Read-only and RLS-scoped: it uses the anon/session client, never
 * service-role, so it can only ever return rows the caller may already see.
 */
const CursorSchema = z.object({
  // The shuffle the first page was dealt from. A later page must use the same
  // one or it would overlap and skip — see 0007_feed_shuffle.sql.
  seed: z.string().min(1).max(32),
  key: z.coerce.number().int(),
  id: z.string().uuid(),
});

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  // No cursor asks for an opening page, which is what /problems does: it
  // prerenders a shell and the feed deals its own first page from here.
  const wantsFirstPage = !searchParams.has('seed');

  const parsed = CursorSchema.safeParse({
    seed: searchParams.get('seed'),
    key: searchParams.get('key'),
    id: searchParams.get('id'),
  });

  if (!wantsFirstPage && !parsed.success) {
    return NextResponse.json({ error: 'invalid cursor' }, { status: 400 });
  }

  try {
    const db = await createClient();
    const page = await fetchFeedPage(db, parsed.success ? parsed.data : null);
    return NextResponse.json(page);
  } catch {
    // Never surface the raw Postgres error — it can echo query internals.
    return NextResponse.json({ error: 'feed unavailable' }, { status: 500 });
  }
}
