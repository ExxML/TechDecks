/**
 * Monthly delta sync. Runs in GitHub Actions; also runnable locally.
 *
 *   npx tsx scripts/sync-delta.ts                 # normal delta run
 *   npx tsx scripts/sync-delta.ts --dry-run       # detect only, write nothing
 *   npx tsx scripts/sync-delta.ts --max-detail 50 # lower the fetch cap
 *   npx tsx scripts/sync-delta.ts --heartbeat     # keep-alive row only, no sync
 *   npx tsx scripts/sync-delta.ts --fresh         # ignore a resumable run
 *
 * Hits `problemsetQuestionList` only (~30 requests, no CSRF needed, far more
 * tolerant than the detail endpoint), recomputes `list_hash` per row, and
 * fetches detail ONLY for slugs that are new or whose listing fields changed.
 *
 * Detection is on list_hash, never content_hash: the listing endpoint returns no
 * bodies, so a delta run can never compute a comparable content_hash. A "changed
 * body" branch written against it would be unreachable code that looks like it
 * works. Honest limitation: a body edited with no listing field changing is
 * undetectable without a full re-crawl — use `npm run seed -- --force-detail`.
 *
 * Uses the SERVICE ROLE key via lib/sync.ts. That key lives in the local .env
 * and in GitHub Actions secrets, never in Vercel.
 */

import { config as loadEnv } from 'dotenv';

import { LeetCodeClient, computeListHash, type LcListItem } from './lib/leetcode';
import {
  SOURCE_ID,
  adminClient,
  findResumableRun,
  orderWorkList,
  startRun,
  updateRun,
  upsertProblem,
  writeHeartbeat,
  type UpsertOutcome,
} from './lib/sync';

loadEnv({ path: '.env.local', quiet: true });

/**
 * Detail fetches per run.
 *
 * At 1 req/sec this is the run's dominant cost. The cap exists so an upstream
 * change that touches thousands of listings cannot turn one scheduled run into
 * a multi-hour crawl. Whatever is skipped is REPORTED, never silently dropped.
 */
const DEFAULT_MAX_DETAIL = 200;
const BATCH_SIZE = 10; // commit + cursor write every N problems

type Args = {
  dryRun: boolean;
  maxDetail: number;
  heartbeat: boolean;
  fresh: boolean;
};

function parseArgs(argv: string[]): Args {
  const args: Args = {
    dryRun: false,
    maxDetail: DEFAULT_MAX_DETAIL,
    heartbeat: false,
    fresh: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--heartbeat') args.heartbeat = true;
    else if (a === '--fresh') args.fresh = true;
    else if (a === '--max-detail' || a.startsWith('--max-detail=')) {
      const raw = a.includes('=') ? a.slice('--max-detail='.length) : (argv[++i] ?? '');
      const n = Number.parseInt(raw, 10);
      if (!Number.isFinite(n) || n <= 0) throw new Error('--max-detail needs a positive integer');
      args.maxDetail = n;
    } else {
      throw new Error(`unknown argument: ${a}`);
    }
  }
  return args;
}

/** What a listing row implies about the work needed for that problem. */
export type Plan = 'new' | 'changed' | 'unchanged';

/** What is already stored for one external_id. */
export type StoredRow = { readonly listHash: string | null; readonly hasBody: boolean };

/**
 * Decide the work for one listing row.
 *
 * Pure, and exported, so the detection rules can be tested without touching
 * LeetCode or the database — the alternative is a test that only runs during a
 * real monthly sync, which is to say never.
 */
export function planFor(item: LcListItem, prior: StoredRow | undefined): Plan {
  if (!prior) return 'new';
  if (prior.listHash !== computeListHash(item)) return 'changed';
  // A paid-only row that has since been freed carries no body, so it is work
  // even when every listing field is identical.
  if (item.isPaidOnly !== true && !prior.hasBody) return 'changed';
  return 'unchanged';
}

/**
 * Apply the detail-fetch cap to an ordered work list.
 *
 * Paid-only rows are listing-writes that cost no detail fetch, so they are kept
 * unconditionally; counting them against the cap would under-sync for no reason.
 * Returns what to process and how many detail fetches were deferred — the
 * caller must REPORT the deferral, since a silent truncation reads as "fully
 * synced" when it is not.
 */
export function applyDetailCap(
  work: readonly LcListItem[],
  maxDetail: number,
): { scheduled: LcListItem[]; deferred: number } {
  let budget = maxDetail;
  const scheduled: LcListItem[] = [];
  let deferred = 0;

  for (const item of work) {
    if (item.isPaidOnly === true) {
      scheduled.push(item);
      continue;
    }
    if (budget > 0) {
      scheduled.push(item);
      budget--;
    } else {
      deferred++;
    }
  }
  return { scheduled, deferred };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const db = adminClient();

  // The keep-alive path writes one row and exits. It shares this script so the
  // workflow has a single entry point, but it performs no sync and must never
  // create a `running` row — see writeHeartbeat.
  if (args.heartbeat) {
    await writeHeartbeat(db);
    console.log('[heartbeat] wrote keep-alive row to sync_runs');
    return;
  }

  const lc = new LeetCodeClient({ verbose: true });

  console.log('TechDecks delta sync');
  console.log(`  dryRun=${args.dryRun} maxDetail=${args.maxDetail} fresh=${args.fresh}`);
  console.log('');

  // ---- Catalog (listing only) ----------------------------------------------
  console.log('[catalog] fetching problemsetQuestionList...');
  const listed = await lc.fetchAllListItems((fetched, total) => {
    console.log(`      ${fetched}/${total}`);
  });
  console.log(`[catalog] ${listed.length} problems listed`);

  // ---- What already exists --------------------------------------------------
  // One pass over the stored rows rather than a query per problem: 4k rows is
  // small, and 4k round trips at scheduled-job latency is not.
  const stored = new Map<string, { listHash: string | null; hasBody: boolean }>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from('content_items')
      .select('external_id, content_hash, metadata')
      .eq('source_id', SOURCE_ID)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`existing scan failed: ${error.message}`);
    const rows = (data ?? []) as Array<{
      external_id: string | null;
      content_hash: string | null;
      metadata: Record<string, unknown> | null;
    }>;
    for (const r of rows) {
      if (!r.external_id) continue;
      const lh = r.metadata?.list_hash;
      stored.set(r.external_id, {
        listHash: typeof lh === 'string' ? lh : null,
        hasBody: r.content_hash !== null,
      });
    }
    if (rows.length < PAGE) break;
  }
  console.log(`[existing] ${stored.size} rows already stored`);

  // ---- Plan ------------------------------------------------------------------
  const plans = new Map<string, Plan>();
  let newCount = 0;
  let changedCount = 0;

  for (const item of listed) {
    const externalId = item.frontendQuestionId ?? '';
    if (!externalId) continue;

    const plan = planFor(item, stored.get(externalId));
    plans.set(externalId, plan);
    if (plan === 'new') newCount++;
    else if (plan === 'changed') changedCount++;
  }

  console.log(`[plan] new=${newCount} changed=${changedCount} unchanged=${listed.length - newCount - changedCount}`);

  // Only rows needing work enter the ordered list, so `cursor` indexes the WORK,
  // not the catalog. Ordering is shared with the seed so resume is stable.
  const work = orderWorkList(
    listed.filter((i) => {
      const p = plans.get(i.frontendQuestionId ?? '');
      return p === 'new' || p === 'changed';
    }),
  );

  if (work.length === 0) {
    console.log('[work] nothing to do — catalog is current');
    const run = await startRun(db);
    await updateRun(db, run.id, { status: 'completed', cursor: 0, processed: 0, failed: 0 });
    return;
  }

  // ---- Cap -------------------------------------------------------------------
  const detailWork = work.filter((i) => i.isPaidOnly !== true);
  const { scheduled, deferred } = applyDetailCap(work, args.maxDetail);

  // A silent truncation reads as "fully synced" when it is not, so the deferred
  // count is always reported — this is the plan's explicit requirement.
  if (deferred > 0) {
    console.log(
      `[cap] ${detailWork.length} problems need detail; fetching ${args.maxDetail}, ` +
        `SKIPPING ${deferred} until the next run`,
    );
  }

  if (args.dryRun) {
    console.log(`[dry-run] would process ${scheduled.length} problems; writing nothing`);
    for (const i of scheduled.slice(0, 20)) {
      console.log(`    ${plans.get(i.frontendQuestionId ?? '')}  ${i.titleSlug}`);
    }
    if (scheduled.length > 20) console.log(`    … and ${scheduled.length - 20} more`);
    return;
  }

  // ---- Resume ----------------------------------------------------------------
  // sync_runs is the ONLY resume authority. GitHub Actions runners are
  // ephemeral, so a checkpoint file would resume from zero on every run and
  // re-burn the whole fetch budget after any crash.
  let run = args.fresh ? null : await findResumableRun(db);
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

  // A resumed cursor indexes a work list rebuilt from a FRESH listing, so it can
  // legitimately exceed the new list's length — for example when the previous
  // run already committed most of the work. Completing is correct here.
  if (cursor >= scheduled.length) {
    console.log('[resume] cursor is already past the work list; nothing to do');
    await updateRun(db, run.id, { status: 'completed', processed, failed });
    return;
  }

  console.log(`[work] ${scheduled.length - cursor} problems to process\n`);
  const startedAt = Date.now();

  try {
    while (cursor < scheduled.length) {
      const batchEnd = Math.min(cursor + BATCH_SIZE, scheduled.length);

      for (let i = cursor; i < batchEnd; i++) {
        const item = scheduled[i];
        const slug = item.titleSlug ?? '(no slug)';
        try {
          const outcome = await upsertProblem(db, lc, item, { forceDetail: false });
          counts[outcome]++;
          if (outcome === 'failed') failed++;
          else processed++;
          console.log(`  [${i + 1}/${scheduled.length}] ${slug} — ${outcome}`);
        } catch (err) {
          failed++;
          counts.failed++;
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`  [${i + 1}/${scheduled.length}] ${slug} — ERROR ${msg}`);
        }
      }

      // Cursor advances only after the whole batch is committed, so a crash
      // re-does at most BATCH_SIZE problems (upserts are idempotent anyway).
      cursor = batchEnd;
      await updateRun(db, run.id, { cursor, processed, failed });

      const elapsed = (Date.now() - startedAt) / 1000;
      console.log(`  -- cursor ${cursor}/${scheduled.length}  elapsed ${Math.round(elapsed)}s`);
    }

    await updateRun(db, run.id, { status: 'completed', cursor, processed, failed });
    console.log('\n[done] delta run completed');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await updateRun(db, run.id, {
      status: 'failed',
      cursor,
      processed,
      failed,
      error: msg.slice(0, 2000),
    });
    console.error(`\n[done] delta run FAILED: ${msg}`);
    process.exitCode = 1;
  }

  console.log('');
  console.log(`  written           : ${counts.written}`);
  console.log(`  paid-only         : ${counts['paid-only']}`);
  console.log(`  skipped-unchanged : ${counts['skipped-unchanged']}`);
  console.log(`  failed            : ${counts.failed}`);
  if (deferred > 0) {
    console.log(`  DEFERRED to next run: ${deferred}`);
  }
}

// Guard so the verification script can import the pure helpers above without
// triggering a real sync on import.
if (process.argv[1] && process.argv[1].includes('sync-delta')) {
  main().catch((err: unknown) => {
    console.error('delta sync crashed:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
