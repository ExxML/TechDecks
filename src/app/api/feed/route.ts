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
  sortKey: z.coerce.number().int(),
  id: z.string().uuid(),
});

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const parsed = CursorSchema.safeParse({
    sortKey: searchParams.get('sortKey'),
    id: searchParams.get('id'),
  });

  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid cursor' }, { status: 400 });
  }

  try {
    const db = await createClient();
    const page = await fetchFeedPage(db, parsed.data);
    return NextResponse.json(page);
  } catch {
    // Never surface the raw Postgres error — it can echo query internals.
    return NextResponse.json({ error: 'feed unavailable' }, { status: 500 });
  }
}
