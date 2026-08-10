/**
 * The shared WRITE path for every sync entry point.
 *
 * `leetcode.ts` is the only place LeetCode is read from; this is the only place
 * content_items is written to. The bulk seed and the scheduled delta job both
 * import both modules — neither forks the logic, because the two must agree on
 * hashing, tag normalization, and `metadata.topic_text` or search breaks
 * silently.
 *
 * Uses the SERVICE ROLE key, which bypasses RLS. That is correct here and only
 * here: sync writes public content_items rows that no RLS policy permits. These
 * callers run on the author's machine and in GitHub Actions, never on Vercel.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import {
  LeetCodeClient,
  computeContentHash,
  computeListHash,
  normalizeDifficulty,
  normalizeTags,
  topicTextFrom,
  parseJsonField,
  acRateFromStats,
  type LcListItem,
  type NormalizedTag,
} from './leetcode';
import { sanitizeProblemHtml } from '../../src/lib/sanitizeNode';

export const SOURCE_ID = 'leetcode';

// ===========================================================================
// Supabase (service role)
// ===========================================================================

export function adminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error('NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL) is not set');
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

// ===========================================================================
// sync_runs — the single resume authority
//
// Not the checkpoint file: GitHub Actions runners are ephemeral, so a gitignored
// .sync-checkpoint.json silently resumes from zero on every run and re-burns the
// whole fetch budget after any crash.
// ===========================================================================

export type SyncRun = { id: string; cursor: number; processed: number; failed: number };

/**
 * The newest interrupted run for this source, if any.
 *
 * The `status = 'running'` filter is load-bearing: the weekly keep-alive writes
 * to this same table, and a heartbeat row mistaken for an interrupted sync would
 * trigger a spurious resume.
 */
export async function findResumableRun(db: SupabaseClient): Promise<SyncRun | null> {
  const { data, error } = await db
    .from('sync_runs')
    .select('id, cursor, processed, failed')
    .eq('source_id', SOURCE_ID)
    .eq('status', 'running')
    .order('started_at', { ascending: false })
    .limit(1);
  if (error) throw new Error(`sync_runs lookup failed: ${error.message}`);
  return data && data.length > 0 ? (data[0] as SyncRun) : null;
}

export async function startRun(db: SupabaseClient): Promise<SyncRun> {
  const { data, error } = await db
    .from('sync_runs')
    .insert({ source_id: SOURCE_ID, status: 'running', cursor: 0, processed: 0, failed: 0 })
    .select('id, cursor, processed, failed')
    .single();
  if (error) throw new Error(`could not start sync_run: ${error.message}`);
  return data as SyncRun;
}

export async function updateRun(
  db: SupabaseClient,
  id: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const { error } = await db.from('sync_runs').update(patch).eq('id', id);
  if (error) throw new Error(`sync_runs update failed: ${error.message}`);
}

/**
 * The weekly keep-alive row.
 *
 * Supabase free projects pause after 7 days with NO database activity, and a
 * monthly sync alone does not clear that bar. `status = 'heartbeat'` is what
 * keeps findResumableRun() from treating this as an interrupted sync.
 */
export async function writeHeartbeat(db: SupabaseClient): Promise<void> {
  const { error } = await db
    .from('sync_runs')
    .insert({ source_id: SOURCE_ID, status: 'heartbeat', cursor: 0, processed: 0, failed: 0 });
  if (error) throw new Error(`heartbeat insert failed: ${error.message}`);
}

// ===========================================================================
// Tag upsert — cached so a 2900-problem run does not re-query per problem
// ===========================================================================

const tagIdCache = new Map<string, string>();

async function ensureTagIds(db: SupabaseClient, tags: NormalizedTag[]): Promise<string[]> {
  const missing = tags.filter((t) => !tagIdCache.has(t.slug));

  if (missing.length > 0) {
    const { error } = await db
      .from('tags')
      .upsert(
        missing.map((t) => ({ slug: t.slug, name: t.name, category: 'topic' })),
        { onConflict: 'slug', ignoreDuplicates: true },
      );
    if (error) throw new Error(`tag upsert failed: ${error.message}`);

    const { data, error: selErr } = await db
      .from('tags')
      .select('id, slug')
      .in('slug', missing.map((t) => t.slug));
    if (selErr) throw new Error(`tag select failed: ${selErr.message}`);
    for (const row of (data ?? []) as Array<{ id: string; slug: string }>) {
      tagIdCache.set(row.slug, row.id);
    }
  }

  const ids: string[] = [];
  for (const t of tags) {
    const id = tagIdCache.get(t.slug);
    if (id) ids.push(id);
  }
  return ids;
}

/**
 * Write the content_item_tags join rows for one item.
 *
 * EVERY branch that writes metadata.topic_text must also call this — including
 * the paid-only branch, which returns early. The two are views of the same
 * normalizeTags() output, and if one is written without the other, topic search
 * silently returns nothing, with no error to notice.
 */
export async function writeTagJoins(
  db: SupabaseClient,
  contentItemId: string,
  tags: NormalizedTag[],
): Promise<void> {
  if (tags.length === 0) return;
  const tagIds = await ensureTagIds(db, tags);
  if (tagIds.length === 0) return;
  const { error } = await db.from('content_item_tags').upsert(
    tagIds.map((tag_id) => ({ content_item_id: contentItemId, tag_id })),
    { onConflict: 'content_item_id,tag_id', ignoreDuplicates: true },
  );
  if (error) throw new Error(`content_item_tags upsert failed: ${error.message}`);
}

// ===========================================================================
// One problem
// ===========================================================================

export type UpsertOutcome = 'written' | 'skipped-unchanged' | 'paid-only' | 'failed';

/**
 * Upsert one problem, fetching its detail only when needed.
 *
 * Detection is on `metadata.list_hash`, never on content_hash: the listing
 * endpoint returns no bodies, so a delta run can never compute a comparable
 * content_hash. content_hash exists to suppress a no-op UPDATE at write time.
 */
export async function upsertProblem(
  db: SupabaseClient,
  lc: LeetCodeClient,
  item: LcListItem,
  opts: { forceDetail: boolean },
): Promise<UpsertOutcome> {
  const slug = item.titleSlug ?? '';
  const externalId = item.frontendQuestionId ?? null;
  if (!slug || !externalId) return 'failed';

  const listHash = computeListHash(item);

  // Existing row? Used both to skip unchanged details and to suppress no-op writes.
  const { data: existingRows, error: exErr } = await db
    .from('content_items')
    .select('id, content_hash, metadata')
    .eq('source_id', SOURCE_ID)
    .eq('external_id', externalId)
    .limit(1);
  if (exErr) throw new Error(`existing lookup failed: ${exErr.message}`);
  const existing =
    existingRows && existingRows.length > 0
      ? (existingRows[0] as {
          id: string;
          content_hash: string | null;
          metadata: Record<string, unknown>;
        })
      : null;

  const priorListHash =
    existing && typeof existing.metadata?.list_hash === 'string'
      ? (existing.metadata.list_hash as string)
      : null;

  // Paid-only: record the row, leave body_html null. Verified against the API —
  // these return 200 with content:null rather than an error.
  if (item.isPaidOnly === true) {
    const tags = normalizeTags(item.topicTags);
    const metadata = {
      frontendId: externalId,
      acRate: item.acRate ?? null,
      isPaidOnly: true,
      topic_text: topicTextFrom(tags),
      list_hash: listHash,
    };
    const { data: upsertedPaid, error } = await db
      .from('content_items')
      .upsert(
        {
          source_id: SOURCE_ID,
          external_id: externalId,
          slug,
          title: item.title ?? slug,
          body_html: null,
          body_format: 'html',
          difficulty: normalizeDifficulty(item.difficulty),
          metadata,
          visibility: 'public',
          owner_id: null,
          content_hash: null,
          sort_key: Number.parseInt(externalId, 10) || null,
          synced_at: new Date().toISOString(),
        },
        { onConflict: 'source_id,external_id' },
      )
      .select('id')
      .single();
    if (error) throw new Error(`paid-only upsert failed for ${slug}: ${error.message}`);

    // Paid rows still carry tags. topic_text was just written above, so the
    // join rows must be written too or the two drift apart.
    await writeTagJoins(db, (upsertedPaid as { id: string }).id, tags);
    return 'paid-only';
  }

  // Free problem whose listing fields are unchanged — no detail fetch needed.
  if (!opts.forceDetail && existing && priorListHash === listHash && existing.content_hash) {
    return 'skipped-unchanged';
  }

  const q = await lc.fetchQuestion(slug);
  if (!q) return 'failed';

  const sanitized = sanitizeProblemHtml(q.content ?? null);
  const contentHash = computeContentHash(sanitized);

  // Tags and topic_text come from ONE call to normalizeTags. They must never be
  // derived separately: topic_text feeds the generated search_vector, and if it
  // drifts from content_item_tags, topic search silently returns nothing.
  const tags = normalizeTags(q.topicTags ?? item.topicTags);
  const stats = parseJsonField(q.stats);

  const metadata = {
    frontendId: q.questionFrontendId ?? externalId,
    acRate: item.acRate ?? acRateFromStats(stats),
    isPaidOnly: false,
    likes: q.likes ?? null,
    dislikes: q.dislikes ?? null,
    hints: q.hints ?? [],
    exampleTestcases: q.exampleTestcases ?? null,
    codeSnippets: q.codeSnippets ?? [],
    topic_text: topicTextFrom(tags),
    similarQuestions: parseJsonField(q.similarQuestions) ?? [],
    stats: stats ?? {},
    list_hash: listHash,
  };

  const { data: upserted, error } = await db
    .from('content_items')
    .upsert(
      {
        source_id: SOURCE_ID,
        external_id: externalId,
        slug,
        title: q.title ?? item.title ?? slug,
        body_html: sanitized,
        body_format: 'html',
        difficulty: normalizeDifficulty(q.difficulty ?? item.difficulty),
        metadata,
        visibility: 'public',
        owner_id: null,
        content_hash: contentHash,
        sort_key: Number.parseInt(q.questionFrontendId ?? externalId, 10) || null,
        synced_at: new Date().toISOString(),
      },
      { onConflict: 'source_id,external_id' },
    )
    .select('id')
    .single();
  if (error) throw new Error(`upsert failed for ${slug}: ${error.message}`);

  // Same shared tag list -> join rows, through the same helper the paid-only
  // branch uses. Written every time so a tag change on an existing problem is
  // reflected rather than accumulating stale rows.
  await writeTagJoins(db, (upserted as { id: string }).id, tags);

  return 'written';
}

/**
 * Deterministic work order, by frontendQuestionId ascending.
 *
 * Resume depends on this ordering being stable across runs — `sync_runs.cursor`
 * is an index into this list, so a different order would resume at the wrong
 * problem.
 */
export function orderWorkList(items: LcListItem[]): LcListItem[] {
  return [...items].sort((a, b) => {
    const ai = Number.parseInt(a.frontendQuestionId ?? '0', 10) || 0;
    const bi = Number.parseInt(b.frontendQuestionId ?? '0', 10) || 0;
    return ai - bi;
  });
}
