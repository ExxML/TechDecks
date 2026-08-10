/**
 * Bulk load of the LeetCode catalog into content_items.
 *
 *   npx tsx scripts/seed.ts --limit 20      # smoke test, 20 problems
 *   npx tsx scripts/seed.ts                 # full run, ~2900 problems, ~50 min
 *   npx tsx scripts/seed.ts --force-detail  # re-fetch details even if unchanged
 *   npx tsx scripts/seed.ts --fresh         # ignore any resumable run, start over
 *
 * Uses the SERVICE ROLE key, which bypasses RLS. That is correct here and only
 * here: sync writes public content_items rows that no RLS policy permits. This
 * script runs on the author's machine and in GitHub Actions, never on Vercel.
 *
 * Resume: sync_runs.cursor counts the slugs fully committed in this run's
 * ordered work list, written alongside each batch's upsert, so a crash resumes
 * rather than restarting the 50-minute run. The gitignored
 * .sync-checkpoint.json caches the slug catalog only and is never the resume
 * authority — CI runners are ephemeral and would resume from zero every time.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config as loadEnv } from 'dotenv';

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
} from './lib/leetcode';
import { sanitizeProblemHtml } from '../src/lib/sanitize';

loadEnv({ path: '.env.local', quiet: true });

const SOURCE_ID = 'leetcode';
const CHECKPOINT_PATH = resolve(process.cwd(), '.sync-checkpoint.json');
const BATCH_SIZE = 10; // commit + cursor write every N problems

// ===========================================================================
// Args
// ===========================================================================

function parseArgs(argv: string[]): {
  limit: number | null;
  forceDetail: boolean;
  fresh: boolean;
} {
  let limit: number | null = null;
  let forceDetail = false;
  let fresh = false;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--limit') {
      const n = Number.parseInt(argv[++i] ?? '', 10);
      if (!Number.isFinite(n) || n <= 0) throw new Error('--limit needs a positive integer');
      limit = n;
    } else if (a.startsWith('--limit=')) {
      const n = Number.parseInt(a.slice('--limit='.length), 10);
      if (!Number.isFinite(n) || n <= 0) throw new Error('--limit needs a positive integer');
      limit = n;
    } else if (a === '--force-detail') {
      forceDetail = true;
    } else if (a === '--fresh') {
      fresh = true;
    } else {
      throw new Error(`unknown argument: ${a}`);
    }
  }
  return { limit, forceDetail, fresh };
}

// ===========================================================================
// Supabase (service role)
// ===========================================================================

function adminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error('NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL) is not set');
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

// ===========================================================================
// Checkpoint — slug catalog cache only, never the resume authority
// ===========================================================================

type Checkpoint = { fetchedAt: string; items: LcListItem[] };

function readCheckpoint(): Checkpoint | null {
  if (!existsSync(CHECKPOINT_PATH)) return null;
  try {
    const parsed: unknown = JSON.parse(readFileSync(CHECKPOINT_PATH, 'utf8'));
    if (typeof parsed !== 'object' || parsed === null) return null;
    const cp = parsed as Partial<Checkpoint>;
    if (!Array.isArray(cp.items) || typeof cp.fetchedAt !== 'string') return null;
    // Catalog older than a day is not worth trusting for a fresh bulk load.
    if (Date.now() - Date.parse(cp.fetchedAt) > 24 * 60 * 60 * 1000) return null;
    return { fetchedAt: cp.fetchedAt, items: cp.items };
  } catch {
    return null;
  }
}

function writeCheckpoint(items: LcListItem[]): void {
  const payload: Checkpoint = { fetchedAt: new Date().toISOString(), items };
  writeFileSync(CHECKPOINT_PATH, JSON.stringify(payload), 'utf8');
}

// ===========================================================================
// sync_runs — the resume authority
// ===========================================================================

type SyncRun = { id: string; cursor: number; processed: number; failed: number };

async function findResumableRun(db: SupabaseClient): Promise<SyncRun | null> {
  // status='heartbeat' rows are written by the weekly keep-alive and must never
  // be mistaken for an interrupted sync, hence the explicit 'running' filter.
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

async function startRun(db: SupabaseClient): Promise<SyncRun> {
  const { data, error } = await db
    .from('sync_runs')
    .insert({ source_id: SOURCE_ID, status: 'running', cursor: 0, processed: 0, failed: 0 })
    .select('id, cursor, processed, failed')
    .single();
  if (error) throw new Error(`could not start sync_run: ${error.message}`);
  return data as SyncRun;
}

async function updateRun(
  db: SupabaseClient,
  id: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const { error } = await db.from('sync_runs').update(patch).eq('id', id);
  if (error) throw new Error(`sync_runs update failed: ${error.message}`);
}

// ===========================================================================
// Tag upsert — cached so a 2900-problem run does not re-query per problem
// ===========================================================================

const tagIdCache = new Map<string, string>();

/**
 * Write the content_item_tags join rows for one item.
 *
 * BOTH the paid-only and free branches must call this. metadata.topic_text and
 * these join rows are two views of the same normalizeTags() output, and if one
 * is written without the other, topic search silently returns nothing — a
 * failure with no error message.
 */
async function writeTagJoins(
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

// ===========================================================================
// One problem
// ===========================================================================

type UpsertOutcome = 'written' | 'skipped-unchanged' | 'paid-only' | 'failed';

async function upsertProblem(
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
  const existing = existingRows && existingRows.length > 0
    ? (existingRows[0] as { id: string; content_hash: string | null; metadata: Record<string, unknown> })
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

// ===========================================================================
// Main
// ===========================================================================

async function main(): Promise<void> {
  const { limit, forceDetail, fresh } = parseArgs(process.argv.slice(2));
  const db = adminClient();
  const lc = new LeetCodeClient({ verbose: true });

  console.log('TechDecks seed — bulk load');
  console.log(`  limit=${limit ?? 'none'} forceDetail=${forceDetail} fresh=${fresh}`);
  console.log('');

  // ---- Catalog --------------------------------------------------------------
  let items: LcListItem[];
  const cached = fresh ? null : readCheckpoint();
  if (cached) {
    items = cached.items;
    console.log(`[catalog] using cached slug list from ${cached.fetchedAt} (${items.length} rows)`);
  } else {
    console.log('[catalog] fetching problemsetQuestionList...');
    items = await lc.fetchAllListItems((fetched, total) => {
      console.log(`      ${fetched}/${total}`);
    });
    writeCheckpoint(items);
    console.log(`[catalog] ${items.length} problems (cached to .sync-checkpoint.json)`);
  }

  // Deterministic work order. Resume depends on this ordering being stable
  // across runs — cursor is an index into THIS list.
  items.sort((a, b) => {
    const ai = Number.parseInt(a.frontendQuestionId ?? '0', 10) || 0;
    const bi = Number.parseInt(b.frontendQuestionId ?? '0', 10) || 0;
    return ai - bi;
  });
  if (limit !== null) items = items.slice(0, limit);

  // ---- Resume ---------------------------------------------------------------
  let run = fresh ? null : await findResumableRun(db);
  if (run) {
    console.log(`[resume] continuing sync_run ${run.id} from cursor ${run.cursor}`);
  } else {
    run = await startRun(db);
    console.log(`[resume] started sync_run ${run.id}`);
  }

  let cursor = run.cursor;
  let processed = run.processed;
  let failed = run.failed;
  const counts: Record<UpsertOutcome, number> = {
    written: 0,
    'skipped-unchanged': 0,
    'paid-only': 0,
    failed: 0,
  };

  if (cursor >= items.length) {
    console.log('[resume] cursor is already past the work list; nothing to do');
    await updateRun(db, run.id, { status: 'completed', processed, failed });
    return;
  }

  console.log(`[work] ${items.length - cursor} problems remaining\n`);
  const startedAt = Date.now();

  try {
    while (cursor < items.length) {
      const batchEnd = Math.min(cursor + BATCH_SIZE, items.length);

      for (let i = cursor; i < batchEnd; i++) {
        const item = items[i];
        const slug = item.titleSlug ?? '(no slug)';
        try {
          const outcome = await upsertProblem(db, lc, item, { forceDetail });
          counts[outcome]++;
          if (outcome === 'failed') failed++;
          else processed++;
          console.log(`  [${i + 1}/${items.length}] ${slug} — ${outcome}`);
        } catch (err) {
          failed++;
          counts.failed++;
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`  [${i + 1}/${items.length}] ${slug} — ERROR ${msg}`);
        }
      }

      // Cursor advances only after the whole batch is committed, so a crash
      // re-does at most BATCH_SIZE problems (upserts are idempotent anyway).
      cursor = batchEnd;
      await updateRun(db, run.id, { cursor, processed, failed });

      const elapsed = (Date.now() - startedAt) / 1000;
      const rate = elapsed > 0 ? (cursor - run.cursor) / elapsed : 0;
      const remaining = rate > 0 ? Math.round((items.length - cursor) / rate) : 0;
      console.log(
        `  -- cursor ${cursor}/${items.length}  elapsed ${Math.round(elapsed)}s  eta ~${remaining}s`,
      );
    }

    await updateRun(db, run.id, { status: 'completed', cursor, processed, failed });
    console.log('\n[done] run completed');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await updateRun(db, run.id, { status: 'failed', cursor, processed, failed, error: msg.slice(0, 2000) });
    console.error(`\n[done] run FAILED: ${msg}`);
    process.exitCode = 1;
  }

  console.log('');
  console.log(`  written           : ${counts.written}`);
  console.log(`  skipped-unchanged : ${counts['skipped-unchanged']}`);
  console.log(`  paid-only         : ${counts['paid-only']}`);
  console.log(`  failed            : ${counts.failed}`);
}

main().catch((err: unknown) => {
  console.error('seed crashed:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
