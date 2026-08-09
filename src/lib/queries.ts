import type { SupabaseClient } from '@supabase/supabase-js';
import type { ContentItem, FeedCursor, FeedPage, LeetCodeMetadata, Tag } from './types';

export const FEED_PAGE_SIZE = 10;

/**
 * Columns every feed/detail query selects.
 *
 * The embedded tag join returns `content_item_tags -> tags`, which PostgREST
 * nests one level deeper than the flat shape the UI wants; `mapRow` flattens it.
 */
const ITEM_COLUMNS = `
  id, source_id, external_id, slug, title, body_html, body_format,
  difficulty, metadata, owner_id, visibility, sort_key,
  content_item_tags ( tags ( slug, name ) )
`;

/** The raw row shape PostgREST returns for ITEM_COLUMNS. */
type RawRow = {
  id: string;
  source_id: string;
  external_id: string | null;
  slug: string;
  title: string;
  body_html: string | null;
  body_format: string;
  difficulty: string | null;
  metadata: unknown;
  owner_id: string | null;
  visibility: string;
  sort_key: number | null;
  content_item_tags?: Array<{ tags: { slug: string; name: string } | Array<{ slug: string; name: string }> | null }> | null;
};

function mapRow(row: RawRow): ContentItem {
  const tags: Tag[] = (row.content_item_tags ?? [])
    .flatMap((j) => (Array.isArray(j.tags) ? j.tags : j.tags ? [j.tags] : []))
    .map((t) => ({ slug: t.slug, name: t.name }));

  const metadata: LeetCodeMetadata =
    typeof row.metadata === 'object' && row.metadata !== null
      ? (row.metadata as LeetCodeMetadata)
      : {};

  return {
    id: row.id,
    source_id: row.source_id,
    external_id: row.external_id,
    slug: row.slug,
    title: row.title,
    body_html: row.body_html,
    body_format: row.body_format === 'markdown' ? 'markdown' : 'html',
    difficulty:
      row.difficulty === 'easy' || row.difficulty === 'medium' || row.difficulty === 'hard'
        ? row.difficulty
        : null,
    metadata,
    owner_id: row.owner_id,
    visibility: row.visibility === 'private' ? 'private' : 'public',
    sort_key: row.sort_key,
    tags,
  };
}

/**
 * One page of the public feed, keyset-paginated on (sort_key, id).
 *
 * `body_html is not null` mirrors the partial index and excludes paid-only
 * rows, which would otherwise render as blank full-screen cards.
 */
export async function fetchFeedPage(
  db: SupabaseClient,
  cursor: FeedCursor | null,
  limit = FEED_PAGE_SIZE,
): Promise<FeedPage> {
  let query = db
    .from('content_items')
    .select(ITEM_COLUMNS)
    .eq('visibility', 'public')
    .not('body_html', 'is', null)
    .order('sort_key', { ascending: true })
    .order('id', { ascending: true })
    .limit(limit + 1); // one extra row tells us whether another page exists

  if (cursor) {
    // Keyset on a composite key: strictly greater on sort_key, or equal
    // sort_key with a greater id. PostgREST expresses this as an `or` filter.
    query = query.or(
      `sort_key.gt.${cursor.sortKey},and(sort_key.eq.${cursor.sortKey},id.gt.${cursor.id})`,
    );
  }

  const { data, error } = await query;
  if (error) throw new Error(`feed query failed: ${error.message}`);

  const rows = (data ?? []) as unknown as RawRow[];
  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit).map(mapRow);
  const last = items.at(-1);

  return {
    items,
    nextCursor:
      hasMore && last && last.sort_key !== null ? { sortKey: last.sort_key, id: last.id } : null,
  };
}

/**
 * One problem by slug.
 *
 * `nullsFirst` on owner_id is the residual tiebreak: a signed-in user who
 * authored a problem sharing a slug with a public one can see both rows, and
 * without this the route would pick arbitrarily. The public row always wins.
 */
export async function fetchItemBySlug(
  db: SupabaseClient,
  slug: string,
): Promise<ContentItem | null> {
  const { data, error } = await db
    .from('content_items')
    .select(ITEM_COLUMNS)
    .eq('slug', slug)
    .order('owner_id', { ascending: true, nullsFirst: true })
    .limit(1);

  if (error) throw new Error(`slug lookup failed: ${error.message}`);
  const rows = (data ?? []) as unknown as RawRow[];
  return rows.length > 0 ? mapRow(rows[0]) : null;
}

/**
 * The feed anchored to one problem: that card first, then the normal feed
 * continuing after it, so a deep link never dead-ends.
 */
export async function fetchFeedAnchoredAt(
  db: SupabaseClient,
  anchor: ContentItem,
  limit = FEED_PAGE_SIZE,
): Promise<FeedPage> {
  if (anchor.sort_key === null) {
    return { items: [anchor], nextCursor: null };
  }
  const rest = await fetchFeedPage(db, { sortKey: anchor.sort_key, id: anchor.id }, limit - 1);
  return { items: [anchor, ...rest.items], nextCursor: rest.nextCursor };
}
