import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  ContentItem,
  Difficulty,
  FeedCursor,
  FeedPage,
  LeetCodeMetadata,
  Tag,
} from './types';

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
 * One problem by id, subject to the caller's RLS. Used by the generate route,
 * which must not be usable to read a private problem the caller cannot see.
 */
export async function fetchItemById(db: SupabaseClient, id: string): Promise<ContentItem | null> {
  const { data, error } = await db.from('content_items').select(ITEM_COLUMNS).eq('id', id).limit(1);
  if (error) throw new Error(`item lookup failed: ${error.message}`);
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
  // A private authored problem renders alone: it has no sort_key, and running
  // on into the public feed would put someone's own problem at the head of a
  // list it is deliberately excluded from.
  if (anchor.visibility === 'private' || anchor.sort_key === null) {
    return { items: [anchor], nextCursor: null };
  }
  const rest = await fetchFeedPage(db, { sortKey: anchor.sort_key, id: anchor.id }, limit - 1);
  return { items: [anchor, ...rest.items], nextCursor: rest.nextCursor };
}

/* ------------------------------------------------------------------ *
 * Bookmarks
 * ------------------------------------------------------------------ */

/**
 * The caller's bookmarked problems, newest bookmark first.
 *
 * The embedded join reads `bookmarks -> content_items`, so RLS applies twice:
 * `bm_all` restricts the rows to the caller's own, and `ci_read` restricts the
 * embedded problem. A bookmark on a row the caller can no longer see comes back
 * with a null join and is dropped rather than rendering an empty row.
 */
export async function fetchBookmarks(db: SupabaseClient): Promise<readonly ContentItem[]> {
  const { data, error } = await db
    .from('bookmarks')
    .select(`created_at, content_items ( ${ITEM_COLUMNS} )`)
    .order('created_at', { ascending: false });

  if (error) throw new Error(`bookmark query failed: ${error.message}`);

  type Joined = { content_items: RawRow | RawRow[] | null };
  return ((data ?? []) as unknown as Joined[])
    .flatMap((r) => (Array.isArray(r.content_items) ? r.content_items : r.content_items ? [r.content_items] : []))
    .map(mapRow);
}

/** Which of these problems the caller has bookmarked. */
export async function fetchBookmarkedIds(
  db: SupabaseClient,
  contentItemIds: readonly string[],
): Promise<ReadonlySet<string>> {
  if (contentItemIds.length === 0) return new Set();
  const { data, error } = await db
    .from('bookmarks')
    .select('content_item_id')
    .in('content_item_id', [...contentItemIds]);

  if (error) throw new Error(`bookmark lookup failed: ${error.message}`);
  return new Set(((data ?? []) as Array<{ content_item_id: string }>).map((r) => r.content_item_id));
}

/**
 * `user_id` is set explicitly rather than left to a default: `bm_all`'s
 * `with check` requires it to equal auth.uid(), and the column has no default.
 */
export async function addBookmark(
  db: SupabaseClient,
  userId: string,
  contentItemId: string,
): Promise<void> {
  const { error } = await db
    .from('bookmarks')
    .upsert(
      { user_id: userId, content_item_id: contentItemId },
      { onConflict: 'user_id,content_item_id', ignoreDuplicates: true },
    );
  if (error) throw new Error(`could not bookmark: ${error.message}`);
}

export async function removeBookmark(
  db: SupabaseClient,
  userId: string,
  contentItemId: string,
): Promise<void> {
  const { error } = await db
    .from('bookmarks')
    .delete()
    .eq('user_id', userId)
    .eq('content_item_id', contentItemId);
  if (error) throw new Error(`could not remove bookmark: ${error.message}`);
}

/* ------------------------------------------------------------------ *
 * Authored problems
 * ------------------------------------------------------------------ */

/** The caller's own authored problems, newest first. RLS restricts to owner. */
export async function fetchMyProblems(db: SupabaseClient): Promise<readonly ContentItem[]> {
  const { data, error } = await db
    .from('content_items')
    .select(ITEM_COLUMNS)
    .eq('source_id', 'user')
    .order('created_at', { ascending: false });

  if (error) throw new Error(`my problems query failed: ${error.message}`);
  return ((data ?? []) as unknown as RawRow[]).map(mapRow);
}

/**
 * Base slug from a title: lowercase, ASCII word runs joined by hyphens.
 *
 * A title of only punctuation or non-Latin script yields an empty string, which
 * is not a usable slug — callers fall back to 'problem'.
 */
export function slugifyTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFKD')
    // Combining marks left by NFKD. Written as escapes so the source file's
    // encoding cannot change what this matches.
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
}

/**
 * A slug unique against ALL public slugs plus this owner's private slugs.
 *
 * Per-owner uniqueness alone is insufficient: an authored "Two Sum" produces a
 * private row whose slug collides with the public LeetCode row, and BOTH are
 * visible to that user under `ci_read` — so `/problems/[slug]` would match two
 * rows. The route's `nullsFirst` tiebreak makes that case deterministic; this
 * function is what prevents it from arising.
 *
 * `excludeId` lets an edit keep its own slug instead of colliding with itself.
 */
export async function generateUniqueSlug(
  db: SupabaseClient,
  ownerId: string,
  title: string,
  excludeId?: string,
): Promise<string> {
  const base = slugifyTitle(title) || 'problem';

  // One round trip: every slug that could collide, public or this owner's.
  // `or` covers both arms because RLS already hides other owners' private rows,
  // but the filter is explicit so the query does not depend on that for
  // correctness.
  let query = db
    .from('content_items')
    .select('id, slug')
    .or(`visibility.eq.public,owner_id.eq.${ownerId}`)
    .like('slug', `${base}%`);

  if (excludeId) query = query.neq('id', excludeId);

  const { data, error } = await query;
  if (error) throw new Error(`slug check failed: ${error.message}`);

  const taken = new Set(((data ?? []) as Array<{ slug: string }>).map((r) => r.slug));
  if (!taken.has(base)) return base;

  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  // Practically unreachable; a random suffix beats throwing on the 999th
  // problem sharing a title.
  return `${base}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Fields the author controls. Everything else is pinned by the writer below. */
export type AuthoredProblemInput = {
  readonly title: string;
  readonly body: string;
  readonly difficulty: Difficulty | null;
  readonly tags: readonly string[];
  /** Free text, optional. Fills the prompt's language slot when present. */
  readonly language: string | null;
  /** 1..8 author-defined question kinds. */
  readonly kinds: readonly string[];
};

/**
 * Metadata written for `source_id = 'user'`.
 *
 * `topic_text` is denormalized here for the generated `search_vector`, and is
 * derived from the SAME tag list that the join rows are written from — a single
 * shared code path, because writing the two from different places is exactly
 * how the seed drifted 734 rows.
 */
function authoredMetadata(input: AuthoredProblemInput): Record<string, unknown> {
  return {
    kinds: input.kinds,
    language: input.language,
    // Derived through tagSlugs(), the SAME function writeAuthoredTags() uses to
    // pick join rows. Deriving the two independently is what let the seed's
    // topic_text drift from its tag joins across 734 rows.
    topic_text: tagSlugs(input.tags).join(' '),
  };
}

/** Author-supplied tag names to the slugs the tags table is keyed by. */
function tagSlugs(tagNames: readonly string[]): string[] {
  return tagNames.map((t) => slugifyTitle(t)).filter(Boolean);
}

/**
 * Writes the tag joins for one item, through `set_content_item_tags`.
 *
 * `content_item_tags` has insert/update/delete revoked from `authenticated` —
 * that table is the whole tag graph, and the revoke is deliberate defense in
 * depth. The RPC is the narrow exception: it verifies the caller owns the item
 * and that it is source_id = 'user', so public rows stay unreachable, and it
 * only attaches tags that already exist.
 *
 * Shared by create and update so `metadata.topic_text` and `content_item_tags`
 * can never disagree — the drift the seed hit when one branch returned early.
 */
async function writeAuthoredTags(
  db: SupabaseClient,
  contentItemId: string,
  tagNames: readonly string[],
): Promise<void> {
  const { error } = await db.rpc('set_content_item_tags', {
    p_item: contentItemId,
    p_tag_slugs: tagSlugs(tagNames),
  });
  if (error) throw new Error(`could not write tags: ${error.message}`);
}

/**
 * Creates one authored problem.
 *
 * `source_id`, `visibility`, and `owner_id` are pinned here and are also pinned
 * by `ci_insert`'s `with check` — the policy is the authority, this is the
 * honest client.
 */
export async function createAuthoredProblem(
  db: SupabaseClient,
  ownerId: string,
  input: AuthoredProblemInput,
): Promise<ContentItem> {
  const slug = await generateUniqueSlug(db, ownerId, input.title);

  const { data, error } = await db
    .from('content_items')
    .insert({
      source_id: 'user',
      external_id: null,
      slug,
      title: input.title,
      body_html: input.body,
      body_format: 'markdown',
      difficulty: input.difficulty,
      metadata: authoredMetadata(input),
      owner_id: ownerId,
      visibility: 'private',
      sort_key: null,
    })
    .select(ITEM_COLUMNS)
    .single();

  if (error) throw new Error(`could not create problem: ${error.message}`);

  const row = data as unknown as RawRow;
  await writeAuthoredTags(db, row.id, input.tags);
  return mapRow(row);
}

/** Updates one authored problem. Re-slugs only when the title actually changes. */
export async function updateAuthoredProblem(
  db: SupabaseClient,
  ownerId: string,
  id: string,
  currentSlug: string,
  currentTitle: string,
  input: AuthoredProblemInput,
): Promise<ContentItem> {
  const slug =
    input.title === currentTitle
      ? currentSlug
      : await generateUniqueSlug(db, ownerId, input.title, id);

  const { data, error } = await db
    .from('content_items')
    .update({
      slug,
      title: input.title,
      body_html: input.body,
      body_format: 'markdown',
      difficulty: input.difficulty,
      metadata: authoredMetadata(input),
    })
    .eq('id', id)
    .eq('owner_id', ownerId)
    .select(ITEM_COLUMNS)
    .single();

  if (error) throw new Error(`could not update problem: ${error.message}`);

  const row = data as unknown as RawRow;
  await writeAuthoredTags(db, row.id, input.tags);
  return mapRow(row);
}

/** `mcq_sets` and `content_item_tags` cascade from the FK. */
export async function deleteAuthoredProblem(
  db: SupabaseClient,
  ownerId: string,
  id: string,
): Promise<void> {
  const { error } = await db.from('content_items').delete().eq('id', id).eq('owner_id', ownerId);
  if (error) throw new Error(`could not delete problem: ${error.message}`);
}
