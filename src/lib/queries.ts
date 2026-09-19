import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  ContentItem,
  Difficulty,
  FeedPage,
  SearchCursor,
  ShuffleCursor,
  LeetCodeMetadata,
  SearchFilters,
  SearchPage,
  SearchScope,
  Tag,
  TagCount,
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
 * The metadata a card carries to the browser.
 *
 * `metadata` is the sync's capture of everything LeetCode returns, and a row
 * read through PostgREST arrives with all of it — the column is jsonb, so the
 * select cannot narrow it the way `feed_page` does. Anything bound for the
 * client is trimmed here to match that projection, field for field.
 *
 * `hints`, `exampleTestcases` and each snippet's `code` are prompt input and
 * stay server-side, where the generate route reads the column whole. The
 * snippets themselves are kept, minus that code: the language picker names them
 * and the grounded flag counts them.
 */
function clientMetadata(metadata: LeetCodeMetadata): LeetCodeMetadata {
  const { acRate, frontendId, isPaidOnly, likes, dislikes, kinds, language, codeSnippets } =
    metadata;
  return {
    acRate,
    frontendId,
    isPaidOnly,
    likes,
    dislikes,
    kinds,
    language,
    codeSnippets: codeSnippets?.map((s) => ({ lang: s.lang, langSlug: s.langSlug })),
  };
}

/** `mapRow` with the metadata trimmed for the client. See clientMetadata. */
function mapClientRow(row: RawRow): ContentItem {
  const item = mapRow(row);
  return { ...item, metadata: clientMetadata(item.metadata) };
}

/** A fresh shuffle seed. One per feed load — see FeedCursor. */
export function newFeedSeed(): string {
  return Math.random().toString(36).slice(2, 10);
}

/** The row shape `feed_page` returns: ITEM_COLUMNS flat, plus the shuffle key
 *  and tags already aggregated into a jsonb array. */
type FeedRow = Omit<RawRow, 'content_item_tags'> & {
  shuffle_key: number;
  tags: Array<{ slug: string; name: string }> | null;
};

function mapFeedRow(row: FeedRow): ContentItem {
  return {
    ...mapRow({ ...row, content_item_tags: null }),
    tags: (row.tags ?? []).map((t) => ({ slug: t.slug, name: t.name })),
  };
}

/**
 * One page of the public feed, keyset-paginated on the shuffle key.
 *
 * The order is a per-load permutation rather than the catalog's numeric one, so
 * the deck deals differently every refresh. `seed` is what makes that order
 * stable across the pages of a single load; the RPC carries the rest.
 */
export async function fetchFeedPage(
  db: SupabaseClient,
  cursor: ShuffleCursor | null,
  seed: string = cursor?.seed ?? newFeedSeed(),
  limit = FEED_PAGE_SIZE,
): Promise<FeedPage> {
  const { data, error } = await db.rpc('feed_page', {
    p_seed: seed,
    p_after_key: cursor?.key ?? null,
    p_after_id: cursor?.id ?? null,
    p_limit: limit + 1, // one extra row tells us whether another page exists
  });
  if (error) throw new Error(`feed query failed: ${error.message}`);

  const rows = (data ?? []) as FeedRow[];
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const last = page.at(-1);

  return {
    items: page.map(mapFeedRow),
    nextCursor:
      hasMore && last
        ? { kind: 'shuffle', seed, key: Number(last.shuffle_key), id: last.id }
        : null,
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
  return rows.length > 0 ? mapClientRow(rows[0]) : null;
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
 * The feed anchored to one problem: that card first, then a fresh shuffle
 * continuing after it, so a deep link never dead-ends.
 */
export async function fetchFeedAnchoredAt(
  db: SupabaseClient,
  anchor: ContentItem,
  limit = FEED_PAGE_SIZE,
): Promise<FeedPage> {
  // A private authored problem renders alone: running on into the public feed
  // would put someone's own problem at the head of a list it is deliberately
  // excluded from.
  if (anchor.visibility === 'private') {
    return { items: [anchor], nextCursor: null };
  }
  // Dealt from the head of a new shuffle rather than from the anchor's own
  // position in it — the anchor is already on screen, and the rest of the deck
  // is what the reader has not seen.
  const rest = await fetchFeedPage(db, null, newFeedSeed(), limit - 1);
  return {
    items: [anchor, ...rest.items.filter((i) => i.id !== anchor.id)],
    nextCursor: rest.nextCursor,
  };
}

/**
 * One page of a result list as feed cards, continuing from `cursor`.
 *
 * A result list is a closed set — it ends where the search ends rather than
 * running on into the catalog — but it ends at its true end, not at the first
 * page the list happened to have rendered. The search is re-run from the
 * cursor's own filters so the order matches the list the reader was scrolling.
 *
 * The hits carry no body, so the rows are re-read in full, in hit order.
 */
export async function fetchSearchFeedPage(
  db: SupabaseClient,
  filters: SearchFilters,
  cursor: SearchCursor,
  limit = FEED_PAGE_SIZE,
): Promise<FeedPage> {
  const { hits, total } = await searchContentItems(
    db,
    filters,
    limit,
    cursor.offset,
    cursor.scope,
  );
  const items = await fetchItemsBySlugs(db, hits.map((h) => h.slug));
  const offset = cursor.offset + hits.length;

  return {
    items,
    nextCursor: hits.length > 0 && offset < total ? { ...cursor, offset } : null,
  };
}

/**
 * Exactly these problems, in exactly this order.
 *
 * Used when the feed is entered from a result list: the reader chose that
 * order, so paging on must follow it rather than the shuffled catalog. The DB
 * has no opinion about the order, so the rows come back unordered and are
 * re-sorted against the requested slugs here.
 */
export async function fetchItemsBySlugs(
  db: SupabaseClient,
  slugs: readonly string[],
): Promise<readonly ContentItem[]> {
  if (slugs.length === 0) return [];
  const { data, error } = await db
    .from('content_items')
    .select(ITEM_COLUMNS)
    .in('slug', [...slugs])
    .not('body_html', 'is', null)
    // The same tiebreak as fetchItemBySlug: a public row wins a slug it shares
    // with the caller's own authored one.
    .order('owner_id', { ascending: true, nullsFirst: true });

  if (error) throw new Error(`slug list lookup failed: ${error.message}`);

  const bySlug = new Map<string, ContentItem>();
  for (const row of (data ?? []) as unknown as RawRow[]) {
    const item = mapClientRow(row);
    if (!bySlug.has(item.slug)) bySlug.set(item.slug, item);
  }
  // Slugs that resolved to nothing are dropped rather than rendered blank.
  return slugs.map((s) => bySlug.get(s)).filter((i): i is ContentItem => i !== undefined);
}

/* ------------------------------------------------------------------ *
 * Search
 * ------------------------------------------------------------------ */

export const SEARCH_PAGE_SIZE = 30;

/** The row shape `search_content_items` returns. */
type SearchRow = {
  id: string;
  slug: string;
  title: string;
  difficulty: string | null;
  ac_rate: number | string | null;
  sort_key: number | null;
  source_id: string;
  visibility: string;
  owner_id: string | null;
  body_format: string;
  total_count: number;
  listed_at: string | null;
};

/** How each scope narrows and orders the search. See SearchScope. */
const SCOPE_ARGS: Record<SearchScope, { bookmarked: boolean; visited: boolean; order: string | null }> = {
  catalog: { bookmarked: false, visited: false, order: null },
  bookmarks: { bookmarked: true, visited: false, order: 'bookmarked' },
  history: { bookmarked: false, visited: true, order: 'visited' },
};

/**
 * The most recent first page for each scope+filter combination.
 *
 * A result list is remounted from scratch on every navigation to it, and the
 * RPC behind it takes a few hundred milliseconds — long enough that returning
 * to a tab showed a skeleton over results that had not changed. Keeping the
 * last page lets the list paint at once while the refetch confirms it.
 *
 * First pages only: later pages are appended as the list scrolls and are
 * dropped with the rest of the view, as re-entering a list starts it from the
 * top.
 */
const firstPages = new Map<string, SearchPage>();

/** Stable across key order, so the same filters always hash to one entry. */
function searchKey(filters: SearchFilters, scope: SearchScope): string {
  return JSON.stringify([
    scope,
    filters.q.trim(),
    [...filters.difficulties].sort(),
    [...filters.tags].sort(),
    filters.acMin,
    filters.acMax,
    filters.bookmarkedOnly,
    filters.withMcqsOnly,
  ]);
}

/** The last page seen for these filters, or null if this list is new. */
export function cachedSearchPage(filters: SearchFilters, scope: SearchScope): SearchPage | null {
  return firstPages.get(searchKey(filters, scope)) ?? null;
}

/**
 * Drops every cached page. Called when the rows themselves change underneath
 * the cache — a sign-in swaps whose bookmarks and history these are, and a
 * bookmark toggle changes which rows /bookmarks returns.
 *
 * The tag counts go with them: `list_tags_with_counts` is security invoker, so
 * a signed-in caller's own authored problems count toward it.
 */
export function clearSearchCache(): void {
  firstPages.clear();
  tagCounts = null;
}

/**
 * Title search with filters.
 *
 * The RPC is `security invoker`, so RLS decides the result set: an anonymous
 * caller sees the public catalog, a signed-in one additionally sees their own
 * authored problems. This function passes no user id for that reason — sending
 * one would imply the server was doing the filtering, and it is not.
 *
 * Empty filter arrays are sent as null rather than `[]`: the SQL treats null as
 * "no filter", and an empty array would otherwise have to mean the same thing
 * in two places.
 *
 * `scope` narrows the same query to one of the caller's own lists, which is
 * what /bookmarks and /history are: the same title search, the same filters,
 * over fewer rows.
 */
export async function searchContentItems(
  db: SupabaseClient,
  filters: SearchFilters,
  limit = SEARCH_PAGE_SIZE,
  offset = 0,
  scope: SearchScope = 'catalog',
): Promise<SearchPage> {
  const s = SCOPE_ARGS[scope];
  const { data, error } = await db.rpc('search_content_items', {
    p_query: filters.q.trim() || null,
    p_difficulties: filters.difficulties.length > 0 ? [...filters.difficulties] : null,
    p_tag_slugs: filters.tags.length > 0 ? [...filters.tags] : null,
    p_ac_min: filters.acMin,
    p_ac_max: filters.acMax,
    p_bookmarked: s.bookmarked || filters.bookmarkedOnly,
    p_limit: limit,
    p_offset: offset,
    p_visited: s.visited,
    p_order: s.order,
    p_has_mcqs: filters.withMcqsOnly,
  });

  if (error) throw new Error(`search failed: ${error.message}`);

  const rows = (data ?? []) as SearchRow[];
  const page: SearchPage = {
    hits: rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      title: r.title,
      difficulty:
        r.difficulty === 'easy' || r.difficulty === 'medium' || r.difficulty === 'hard'
          ? r.difficulty
          : null,
      // PostgREST renders `numeric` as a string to keep its precision, which
      // this column does not need.
      metadata: { acRate: r.ac_rate === null ? null : Number(r.ac_rate) },
      sort_key: r.sort_key,
      source_id: r.source_id,
      visibility: r.visibility === 'private' ? 'private' : 'public',
      body_format: r.body_format === 'markdown' ? 'markdown' : 'html',
      listed_at: r.listed_at,
    })),
    // count(*) over () repeats the same total on every row, so any row will do.
    total: rows.length > 0 ? Number(rows[0].total_count) : 0,
  };

  if (offset === 0) firstPages.set(searchKey(filters, scope), page);
  return page;
}

/**
 * Tags that actually have matchable problems, most-used first.
 *
 * Memoized until the caller's identity changes. The filter sheet is remounted
 * on every open, and the counts move only when the catalog syncs or the caller
 * authors a problem, so refetching per open was the whole list again for an
 * answer that had not changed. The promise itself is cached, so two opens in
 * flight at once share one request; `clearSearchCache` drops it on a sign-in,
 * which is what keeps one user's authored rows out of the next one's counts.
 */
let tagCounts: Promise<readonly TagCount[]> | null = null;

export function fetchTagCounts(db: SupabaseClient): Promise<readonly TagCount[]> {
  tagCounts ??= (async () => {
    try {
      const { data, error } = await db.rpc('list_tags_with_counts');
      if (error) throw new Error(`tag list failed: ${error.message}`);
      return ((data ?? []) as Array<{ slug: string; name: string; item_count: number }>).map(
        (t) => ({ slug: t.slug, name: t.name, count: Number(t.item_count) }),
      );
    } catch (err) {
      // A failed fetch must not be the cached answer forever: the next open retries.
      tagCounts = null;
      throw err;
    }
  })();
  return tagCounts;
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
 * History
 * ------------------------------------------------------------------ */

/**
 * Marks a problem as visited. First write wins, so the stored timestamp is the
 * first time it was opened; later calls for the same problem are no-ops.
 *
 * Called from the feed as the reader dwells on a card, which means it fires
 * often and must never interrupt reading — failures are swallowed rather than
 * surfaced, and an anonymous caller is a no-op in the RPC itself.
 */
export async function recordVisit(db: SupabaseClient, contentItemId: string): Promise<void> {
  await db.rpc('record_visit', { p_item: contentItemId });
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

/** Metadata written for `source_id = 'user'`. */
function authoredMetadata(input: AuthoredProblemInput): Record<string, unknown> {
  return {
    kinds: input.kinds,
    language: input.language,
    // The tag list denormalized onto the row itself.
    topic_text: tagSlugs(input.tags).join(' '),
  };
}

/**
 * Author-supplied tag names to the slugs the tags table is keyed by.
 *
 * Both `metadata.topic_text` and the `content_item_tags` joins are derived
 * through here, so the two can never disagree. Deriving them separately is how
 * the seed drifted 734 rows.
 */
function tagSlugs(tagNames: readonly string[]): string[] {
  return tagNames.map((t) => slugifyTitle(t)).filter(Boolean);
}

/**
 * Writes the tag joins for one item, through `set_content_item_tags`.
 *
 * `content_item_tags` has insert/update/delete revoked from `authenticated`,
 * that table being the whole tag graph. The RPC is the narrow exception: it
 * verifies the caller owns the item and that it is source_id = 'user', so
 * public rows stay unreachable, and it only attaches tags that already exist.
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
