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

/** Keyset cursor. Pagination is (sort_key, id), never OFFSET — OFFSET degrades
 *  on a long feed and duplicates cards when rows shift mid-scroll. */
export type FeedCursor = {
  readonly sortKey: number;
  readonly id: string;
};

export type FeedPage = {
  readonly items: readonly ContentItem[];
  readonly nextCursor: FeedCursor | null;
};
