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
import { config as loadEnv } from 'dotenv';

import { LeetCodeClient, type LcListItem } from './lib/leetcode';
// The write path lives in one module shared with the delta job. Neither script
// defines its own upsert: the two must agree on hashing, tag normalization, and
// metadata.topic_text, or search breaks with no error message.
import {
  adminClient,
  findResumableRun,
  orderWorkList,
  startRun,
  updateRun,
  upsertProblem,
  type UpsertOutcome,
} from './lib/sync';

loadEnv({ path: '.env.local', quiet: true });

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

  // Deterministic work order, shared with the delta job. Resume depends on this
  // ordering being stable across runs — cursor is an index into THIS list.
  items = orderWorkList(items);
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
