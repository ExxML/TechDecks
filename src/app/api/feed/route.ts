import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { fetchFeedPage, fetchSearchFeedPage } from '@/lib/queries';
import { filtersFromParams } from '@/lib/searchParams';

/**
 * Paginated feed pages for the client's infinite scroll.
 *
 * Read-only and RLS-scoped: it uses the anon/session client, never
 * service-role, so it can only ever return rows the caller may already see.
 * That is what lets `scope` be taken from the request — bookmarks and history
 * are the caller's own rows by RLS, not by anything asserted here.
 */
const ShuffleSchema = z.object({
  // The shuffle the first page was dealt from. A later page must use the same
  // one or it would overlap and skip — see 0007_feed_shuffle.sql.
  seed: z.string().min(1).max(32),
  key: z.coerce.number().int(),
  id: z.string().uuid(),
});

const SearchSchema = z.object({
  scope: z.enum(['catalog', 'bookmarks', 'history']),
  // The result list's own filter query string, replayed to reproduce its order.
  params: z.string().max(2048),
  offset: z.coerce.number().int().min(0),
});

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  try {
    const db = await createClient();

    if (searchParams.has('scope')) {
      const parsed = SearchSchema.safeParse({
        scope: searchParams.get('scope'),
        params: searchParams.get('params') ?? '',
        offset: searchParams.get('offset'),
      });
      if (!parsed.success) {
        return NextResponse.json({ error: 'invalid cursor' }, { status: 400 });
      }
      const filters = filtersFromParams(new URLSearchParams(parsed.data.params));
      const page = await fetchSearchFeedPage(db, filters, {
        kind: 'search',
        ...parsed.data,
      });
      return NextResponse.json(page);
    }

    // No cursor asks for an opening page, which is what /problems does: it
    // prerenders a shell and the feed deals its own first page from here.
    const wantsFirstPage = !searchParams.has('seed');
    const parsed = ShuffleSchema.safeParse({
      seed: searchParams.get('seed'),
      key: searchParams.get('key'),
      id: searchParams.get('id'),
    });

    if (!wantsFirstPage && !parsed.success) {
      return NextResponse.json({ error: 'invalid cursor' }, { status: 400 });
    }

    const page = await fetchFeedPage(
      db,
      parsed.success ? { kind: 'shuffle', ...parsed.data } : null,
    );
    return NextResponse.json(page);
  } catch {
    // Never surface the raw Postgres error — it can echo query internals.
    return NextResponse.json({ error: 'feed unavailable' }, { status: 500 });
  }
}
