/**
 * Domain types.
 *
 * Hand-written rather than generated: the generated Supabase types would
 * describe `metadata` as `Json`, which is exactly the field that needs a real
 * shape. These narrow it at the boundary instead.
 */

export type Difficulty = 'easy' | 'medium' | 'hard';

export type CodeSnippet = {
  readonly lang: string;
  readonly langSlug: string;
  readonly code: string;
};

/** `metadata` for source_id = 'leetcode'. Every field is optional — paid-only
 *  rows carry a deliberately thin subset. */
export type LeetCodeMetadata = {
  readonly frontendId?: string;
  readonly acRate?: number | null;
  readonly isPaidOnly?: boolean;
  readonly likes?: number | null;
  readonly dislikes?: number | null;
  readonly hints?: readonly string[];
  readonly exampleTestcases?: string | null;
  readonly codeSnippets?: readonly CodeSnippet[];
  readonly topic_text?: string;
  readonly similarQuestions?: unknown;
  readonly stats?: unknown;
  readonly list_hash?: string;
  /** Authored problems only: the 1–8 question kinds their author defined, and
   *  an optional free-text language. Synced rows carry neither. */
  readonly kinds?: readonly string[];
  readonly language?: string | null;
};

export type Tag = {
  readonly slug: string;
  readonly name: string;
};

export type ContentItem = {
  readonly id: string;
  readonly source_id: string;
  readonly external_id: string | null;
  readonly slug: string;
  readonly title: string;
  readonly body_html: string | null;
  readonly body_format: 'html' | 'markdown';
  readonly difficulty: Difficulty | null;
  readonly metadata: LeetCodeMetadata;
  readonly owner_id: string | null;
  readonly visibility: 'public' | 'private';
  readonly sort_key: number | null;
  readonly tags: readonly Tag[];
};

/**
 * Keyset cursor, never OFFSET — OFFSET degrades on a long feed and duplicates
 * cards when rows shift mid-scroll.
 *
 * `seed` travels with it because the feed is shuffled per page load: the key is
 * hashtext(id || seed), so a later page must be dealt from the same shuffle or
 * it would overlap and skip. See 0007_feed_shuffle.sql.
 */
export type ShuffleCursor = {
  readonly kind: 'shuffle';
  readonly seed: string;
  readonly key: number;
  readonly id: string;
};

/**
 * Where a result-list feed has reached in its search.
 *
 * Offset paging, unlike the shuffled feed: a ranked search has no stable key to
 * seek on, and it is the same paging the result list itself uses, so the feed
 * continues the list rather than re-deriving it. `params` is the list's own
 * filter query string, which is what makes the order reproducible server-side.
 */
export type SearchCursor = {
  readonly kind: 'search';
  readonly scope: SearchScope;
  readonly params: string;
  readonly offset: number;
};

export type FeedCursor = ShuffleCursor | SearchCursor;

export type FeedPage = {
  readonly items: readonly ContentItem[];
  readonly nextCursor: FeedCursor | null;
};

/**
 * Which list a search runs over. Not a filter: it is fixed by the route rather
 * than chosen in the sheet, and it decides the order a result set falls back to
 * when there is no text query to rank by.
 */
export type SearchScope = 'catalog' | 'bookmarks' | 'history';

/**
 * Search filters. Every field is optional; all of them combine with AND, and
 * multiple tags narrow rather than widen.
 */
export type SearchFilters = {
  readonly q: string;
  readonly difficulties: readonly Difficulty[];
  readonly tags: readonly string[];
  readonly acMin: number | null;
  readonly acMax: number | null;
  readonly bookmarkedOnly: boolean;
};

export const EMPTY_FILTERS: SearchFilters = {
  q: '',
  difficulties: [],
  tags: [],
  acMin: null,
  acMax: null,
  bookmarkedOnly: false,
};

/** True when a filter set would return the whole catalog unchanged. */
export function filtersAreEmpty(f: SearchFilters): boolean {
  return (
    f.q.trim() === '' &&
    f.difficulties.length === 0 &&
    f.tags.length === 0 &&
    f.acMin === null &&
    f.acMax === null &&
    !f.bookmarkedOnly
  );
}

/**
 * A search hit. Deliberately NOT a ContentItem: the search RPC does not join
 * tags or return a body, and widening it to ContentItem would invite a caller
 * to render `tags` as an empty list rather than as "not loaded".
 */
export type SearchHit = {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly difficulty: Difficulty | null;
  readonly metadata: LeetCodeMetadata;
  readonly sort_key: number | null;
  readonly source_id: string;
  readonly visibility: 'public' | 'private';
  readonly body_format: 'html' | 'markdown';
  /** When the row entered the list being searched — the visit time on
   *  `history`, the bookmark time on `bookmarks`. Null on `catalog`. */
  readonly listed_at: string | null;
};

export type SearchPage = {
  readonly hits: readonly SearchHit[];
  /** Total matches before limit/offset, for "N results". */
  readonly total: number;
};

export type TagCount = {
  readonly slug: string;
  readonly name: string;
  readonly count: number;
};
