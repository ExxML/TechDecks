/**
 * Shared LeetCode fetch module — the only place LeetCode is talked to. Both the
 * local bulk load and the scheduled delta sync import this; do not fork it.
 *
 * The `csrftoken` is harvested from /graphql rather than from a problem page:
 * leetcode.com HTML sits behind a Cloudflare interstitial that returns 403 for
 * every header combination, while /graphql is reachable and sets the cookie
 * itself. Read queries do not currently enforce the token, but it is sent
 * anyway since it costs one request per session.
 */

import { createHash } from 'node:crypto';

const GRAPHQL_URL = 'https://leetcode.com/graphql';
const ORIGIN = 'https://leetcode.com';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/** 1 req/sec. Every outbound call goes through throttle(). */
export const THROTTLE_MS = 1000;

/** Refresh the harvested token roughly this often. */
const TOKEN_REFRESH_EVERY = 50;

// ===========================================================================
// Types — hand-written to mirror the GraphQL shape. Every field is optional
// and nullable because this is untrusted upstream data: paid-only problems
// return `content: null`, and LeetCode has changed field nullability before.
// ===========================================================================

export type LcTopicTag = { readonly name?: string | null; readonly slug?: string | null };

export type LcCodeSnippet = {
  readonly lang?: string | null;
  readonly langSlug?: string | null;
  readonly code?: string | null;
};

/** A row from `problemsetQuestionList` — listing fields only, no body. */
export type LcListItem = {
  readonly frontendQuestionId?: string | null;
  readonly title?: string | null;
  readonly titleSlug?: string | null;
  readonly difficulty?: string | null;
  readonly isPaidOnly?: boolean | null;
  readonly acRate?: number | null;
  readonly topicTags?: readonly LcTopicTag[] | null;
};

/** A full problem from `questionData`. */
export type LcQuestion = {
  readonly questionId?: string | null;
  readonly questionFrontendId?: string | null;
  readonly title?: string | null;
  readonly titleSlug?: string | null;
  readonly content?: string | null;
  readonly difficulty?: string | null;
  readonly isPaidOnly?: boolean | null;
  readonly likes?: number | null;
  readonly dislikes?: number | null;
  readonly stats?: string | null;
  readonly hints?: readonly string[] | null;
  readonly exampleTestcases?: string | null;
  readonly topicTags?: readonly LcTopicTag[] | null;
  readonly codeSnippets?: readonly LcCodeSnippet[] | null;
  readonly similarQuestions?: string | null;
};

// ===========================================================================
// Queries
// ===========================================================================

const LIST_QUERY = `
query problemsetQuestionList($categorySlug: String, $limit: Int, $skip: Int, $filters: QuestionListFilterInput) {
  problemsetQuestionList: questionList(
    categorySlug: $categorySlug, limit: $limit, skip: $skip, filters: $filters
  ) {
    total: totalNum
    questions: data {
      frontendQuestionId: questionFrontendId
      title
      titleSlug
      difficulty
      isPaidOnly
      acRate
      topicTags { name slug }
    }
  }
}`;

const QUESTION_QUERY = `
query questionData($titleSlug: String!) {
  question(titleSlug: $titleSlug) {
    questionId
    questionFrontendId
    title
    titleSlug
    content
    difficulty
    isPaidOnly
    likes
    dislikes
    stats
    hints
    exampleTestcases
    topicTags { name slug }
    codeSnippets { lang langSlug code }
    similarQuestions
  }
}`;

// ===========================================================================
// Throttle + backoff
// ===========================================================================

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Serializes all outbound calls to at most one per THROTTLE_MS. */
let lastRequestAt = 0;
async function throttle(): Promise<void> {
  const wait = lastRequestAt + THROTTLE_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
}

export class LeetCodeError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'LeetCodeError';
  }
}

// ===========================================================================
// Client
// ===========================================================================

export type ClientOptions = {
  /** Log a line per request. Off by default so the seed controls its own output. */
  readonly verbose?: boolean;
  /** Attempts per request before giving up. Includes the first try. */
  readonly maxRetries?: number;
};

export class LeetCodeClient {
  private csrf: string | null = null;
  private requestsSinceToken = 0;
  private readonly verbose: boolean;
  private readonly maxRetries: number;

  constructor(opts: ClientOptions = {}) {
    this.verbose = opts.verbose ?? false;
    this.maxRetries = opts.maxRetries ?? 5;
  }

  private log(msg: string): void {
    if (this.verbose) console.log(`      [lc] ${msg}`);
  }

  /**
   * Harvest a csrftoken from /graphql. A bare GET returns 400 "Must provide
   * query string", which is fine — only the Set-Cookie header is wanted.
   */
  private async refreshToken(): Promise<void> {
    await throttle();
    const res = await fetch(GRAPHQL_URL, { headers: { 'User-Agent': USER_AGENT } });
    await res.text(); // drain so the socket is released

    // getSetCookie() is the only way to read multiple Set-Cookie headers; a
    // plain .get() folds them into one comma-joined string and mangles values.
    for (const line of res.headers.getSetCookie()) {
      const m = /(?:^|;\s*)csrftoken=([^;]+)/.exec(line);
      if (m) {
        this.csrf = m[1];
        this.requestsSinceToken = 0;
        this.log(`csrftoken refreshed (len ${m[1].length})`);
        return;
      }
    }
    // Not fatal: reads succeed without it. Recorded so the seed log shows it.
    this.log('WARNING: no csrftoken in Set-Cookie; continuing without one');
    this.csrf = null;
    this.requestsSinceToken = 0;
  }

  private async ensureToken(): Promise<void> {
    if (this.csrf === null || this.requestsSinceToken >= TOKEN_REFRESH_EVERY) {
      await this.refreshToken();
    }
  }

  /**
   * One GraphQL POST with throttle, retry, and exponential backoff on 429/403.
   *
   * Returns the `data` object. Throws LeetCodeError on a non-retryable failure
   * or once retries are exhausted.
   */
  private async graphql<T>(
    operationName: string,
    query: string,
    variables: Record<string, unknown>,
    referer: string,
  ): Promise<T> {
    await this.ensureToken();

    let lastError = '';
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      await throttle();
      this.requestsSinceToken++;

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'User-Agent': USER_AGENT,
        Referer: referer,
        Origin: ORIGIN,
      };
      if (this.csrf) {
        headers['Cookie'] = `csrftoken=${this.csrf}`;
        headers['x-csrftoken'] = this.csrf;
      }

      let res: Response;
      try {
        res = await fetch(GRAPHQL_URL, {
          method: 'POST',
          headers,
          body: JSON.stringify({ operationName, query, variables }),
          signal: AbortSignal.timeout(30_000),
        });
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        const backoff = Math.min(60_000, 2000 * 2 ** (attempt - 1));
        this.log(`network error (${lastError}); backoff ${backoff}ms`);
        await sleep(backoff);
        continue;
      }

      // Rate limited or challenged — back off hard and re-harvest the token.
      if (res.status === 429 || res.status === 403) {
        await res.text();
        const backoff = Math.min(60_000, 2000 * 2 ** (attempt - 1));
        this.log(`HTTP ${res.status}; backoff ${backoff}ms then refresh token`);
        await sleep(backoff);
        await this.refreshToken();
        lastError = `HTTP ${res.status}`;
        continue;
      }

      if (res.status >= 500) {
        await res.text();
        const backoff = Math.min(60_000, 2000 * 2 ** (attempt - 1));
        this.log(`HTTP ${res.status}; backoff ${backoff}ms`);
        await sleep(backoff);
        lastError = `HTTP ${res.status}`;
        continue;
      }

      const raw = await res.text();
      if (!res.ok) {
        throw new LeetCodeError(`${operationName}: HTTP ${res.status} ${raw.slice(0, 200)}`, res.status);
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new LeetCodeError(`${operationName}: response was not JSON: ${raw.slice(0, 200)}`);
      }
      if (typeof parsed !== 'object' || parsed === null) {
        throw new LeetCodeError(`${operationName}: response was not an object`);
      }
      const env = parsed as { data?: unknown; errors?: unknown };
      if (env.errors) {
        throw new LeetCodeError(
          `${operationName}: graphql errors ${JSON.stringify(env.errors).slice(0, 200)}`,
        );
      }
      if (env.data === undefined || env.data === null) {
        throw new LeetCodeError(`${operationName}: response had no data`);
      }
      return env.data as T;
    }

    throw new LeetCodeError(`${operationName}: exhausted ${this.maxRetries} attempts (${lastError})`);
  }

  /** One page of the problem catalog. */
  async fetchListPage(skip: number, limit = 100): Promise<{ total: number; questions: LcListItem[] }> {
    const data = await this.graphql<{
      problemsetQuestionList?: { total?: number | null; questions?: LcListItem[] | null } | null;
    }>(
      'problemsetQuestionList',
      LIST_QUERY,
      { categorySlug: '', limit, skip, filters: {} },
      `${ORIGIN}/problemset/all/`,
    );

    const list = data.problemsetQuestionList;
    return { total: list?.total ?? 0, questions: list?.questions ?? [] };
  }

  /** Walk the whole catalog. Returns every row, paid-only included. */
  async fetchAllListItems(
    onPage?: (fetched: number, total: number) => void,
  ): Promise<LcListItem[]> {
    const out: LcListItem[] = [];
    let skip = 0;
    let total = Number.POSITIVE_INFINITY;

    while (skip < total) {
      const page = await this.fetchListPage(skip, 100);
      total = page.total;
      if (page.questions.length === 0) break;
      out.push(...page.questions);
      skip += page.questions.length;
      onPage?.(out.length, total);
    }
    return out;
  }

  /**
   * Full detail for one slug.
   *
   * Paid-only problems return 200 with `content: null` and `codeSnippets: null`
   * (verified against `design-tic-tac-toe`). That is not an error — the caller
   * records the row and leaves body_html null.
   */
  async fetchQuestion(slug: string): Promise<LcQuestion | null> {
    const data = await this.graphql<{ question?: LcQuestion | null }>(
      'questionData',
      QUESTION_QUERY,
      { titleSlug: slug },
      `${ORIGIN}/problems/${slug}/`,
    );
    return data.question ?? null;
  }
}

// ===========================================================================
// Hashing — two hashes, one shared implementation used by every sync entry
// point, so a value written by one is comparable by the other.
// ===========================================================================

function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/**
 * Hash over listing-visible fields only.
 *
 * This is the delta-detection hash. It deliberately EXCLUDES acRate: acRate
 * drifts continuously, and including it would mark every problem changed on
 * every run, instantly blowing the detail-fetch cap.
 *
 * Computed from a listing row, which is all a delta run has — it never sees a
 * body, which is why content_hash cannot drive detection.
 */
export function computeListHash(item: {
  title?: string | null;
  difficulty?: string | null;
  isPaidOnly?: boolean | null;
  topicTags?: readonly LcTopicTag[] | null;
}): string {
  const tagSlugs = (item.topicTags ?? [])
    .map((t) => t.slug ?? '')
    .filter((s) => s.length > 0)
    .sort();

  return sha256(
    JSON.stringify({
      title: item.title ?? '',
      difficulty: (item.difficulty ?? '').toLowerCase(),
      isPaidOnly: item.isPaidOnly ?? false,
      tags: tagSlugs,
    }),
  );
}

/**
 * Hash over the sanitized body HTML.
 *
 * Used at write time to skip a no-op UPDATE, not for detection: the listing
 * endpoint returns no bodies, so a delta run could never compute a match.
 */
export function computeContentHash(sanitizedHtml: string | null): string | null {
  if (sanitizedHtml === null) return null;
  return sha256(sanitizedHtml);
}

// ===========================================================================
// Normalization — the single shared code path for tags and topic_text
//
// metadata.topic_text is denormalized: it feeds the generated search_vector
// column but is derived from the same tags that populate content_item_tags.
// Seed and delta MUST write both from here. If they drift, topic search
// silently returns nothing — a failure with no error message.
// ===========================================================================

export type NormalizedTag = { readonly slug: string; readonly name: string };

/** Dedupe + sort tags so topic_text and content_item_tags can never disagree. */
export function normalizeTags(tags: readonly LcTopicTag[] | null | undefined): NormalizedTag[] {
  const bySlug = new Map<string, NormalizedTag>();
  for (const t of tags ?? []) {
    const slug = (t.slug ?? '').trim();
    if (!slug) continue;
    if (!bySlug.has(slug)) bySlug.set(slug, { slug, name: (t.name ?? slug).trim() || slug });
  }
  return [...bySlug.values()].sort((a, b) => a.slug.localeCompare(b.slug));
}

/**
 * The denormalized search string for metadata.topic_text.
 *
 * Derived from the SAME normalizeTags() output that produces content_item_tags
 * rows. Never build this string anywhere else.
 */
export function topicTextFrom(tags: readonly NormalizedTag[]): string {
  return tags.map((t) => t.slug).join(' ');
}

/** Map LeetCode's difficulty casing onto the difficulty_level enum. */
export function normalizeDifficulty(d: string | null | undefined): 'easy' | 'medium' | 'hard' | null {
  switch ((d ?? '').toLowerCase()) {
    case 'easy':
      return 'easy';
    case 'medium':
      return 'medium';
    case 'hard':
      return 'hard';
    default:
      return null;
  }
}

/** `stats` and `similarQuestions` arrive as JSON-encoded strings. */
export function parseJsonField(raw: string | null | undefined): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** acRate lives inside the stats blob on questionData, but is a column on the listing. */
export function acRateFromStats(stats: unknown): number | null {
  if (typeof stats !== 'object' || stats === null) return null;
  const raw = (stats as { acRate?: unknown }).acRate;
  if (typeof raw !== 'string') return null;
  const n = Number.parseFloat(raw.replace('%', ''));
  return Number.isFinite(n) ? n : null;
}
