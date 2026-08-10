/**
 * Delta sync: detection rules, the fetch cap, and sync_runs resume semantics.
 *
 *   npx tsx scripts/verify-sync.mts
 *
 * The detection and cap rules are checked as pure functions, so they are
 * verified on every run rather than only during a real monthly sync. The
 * sync_runs checks hit the real table, because the heartbeat-vs-resume
 * distinction is exactly the thing a pure test cannot prove.
 *
 * Cleans up after itself.
 */

import { config } from 'dotenv';
import { computeListHash, type LcListItem } from '../scripts/lib/leetcode';
import {
  SOURCE_ID,
  adminClient,
  findResumableRun,
  startRun,
  updateRun,
  writeHeartbeat,
  orderWorkList,
} from '../scripts/lib/sync';
import { planFor, applyDetailCap, type StoredRow } from '../scripts/sync-delta';

config({ path: '.env.local', quiet: true });

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

const listing = (over: Partial<LcListItem> = {}): LcListItem => ({
  frontendQuestionId: '1',
  title: 'Two Sum',
  titleSlug: 'two-sum',
  difficulty: 'Easy',
  isPaidOnly: false,
  acRate: 55.3,
  topicTags: [{ name: 'Array', slug: 'array' }],
  ...over,
});

/* ---------------------------------------------------------------- *
 * Detection
 * ---------------------------------------------------------------- */
function detectionChecks(): void {
  console.log('\n=== delta detection (list_hash) ===');

  const item = listing();
  const current: StoredRow = { listHash: computeListHash(item), hasBody: true };

  check('an unseen slug is new', planFor(item, undefined) === 'new');
  check('an unchanged listing is skipped', planFor(item, current) === 'unchanged');

  check(
    'a retitled problem is changed',
    planFor(listing({ title: 'Two Sums' }), current) === 'changed',
  );
  check(
    'a difficulty change is detected',
    planFor(listing({ difficulty: 'Medium' }), current) === 'changed',
  );
  check(
    'a tag change is detected',
    planFor(listing({ topicTags: [{ name: 'Tree', slug: 'tree' }] }), current) === 'changed',
  );
  check(
    'a paid-only flip is detected',
    planFor(listing({ isPaidOnly: true }), current) === 'changed',
  );

  // The single most important negative: acRate drifts continuously, and
  // including it would mark every problem changed on every run, instantly
  // blowing the detail-fetch cap.
  check(
    'an acRate drift is NOT a change',
    planFor(listing({ acRate: 61.9 }), current) === 'unchanged',
    'acRate is deliberately excluded from list_hash',
  );

  // A previously paid-only row that has been freed carries no body, so it is
  // work even when every listing field matches.
  const freed = listing({ isPaidOnly: false });
  check(
    'a freed problem with no stored body is changed',
    planFor(freed, { listHash: computeListHash(freed), hasBody: false }) === 'changed',
  );
  // ...but a still-paid row legitimately has no body and must not be re-fetched
  // forever.
  const paid = listing({ isPaidOnly: true });
  check(
    'a still-paid row with no body is NOT re-fetched every run',
    planFor(paid, { listHash: computeListHash(paid), hasBody: false }) === 'unchanged',
  );

  // Tag ORDER must not matter, or every run would see a spurious change.
  const reordered = listing({
    topicTags: [
      { name: 'Hash Table', slug: 'hash-table' },
      { name: 'Array', slug: 'array' },
    ],
  });
  const sameTags = listing({
    topicTags: [
      { name: 'Array', slug: 'array' },
      { name: 'Hash Table', slug: 'hash-table' },
    ],
  });
  check(
    'tag order does not affect list_hash',
    computeListHash(reordered) === computeListHash(sameTags),
  );
}

/* ---------------------------------------------------------------- *
 * Cap
 * ---------------------------------------------------------------- */
function capChecks(): void {
  console.log('\n=== detail-fetch cap ===');

  const free = Array.from({ length: 250 }, (_, i) =>
    listing({ frontendQuestionId: String(i + 1), titleSlug: `p-${i + 1}`, isPaidOnly: false }),
  );

  const { scheduled, deferred } = applyDetailCap(free, 200);
  check('the cap limits detail fetches to 200', scheduled.length === 200, `${scheduled.length}`);
  check('the remainder is reported, not dropped silently', deferred === 50, `${deferred}`);

  // Paid-only rows are listing-writes costing no detail fetch, so capping them
  // would under-sync for no reason.
  const mixed = [
    ...Array.from({ length: 5 }, (_, i) =>
      listing({ frontendQuestionId: `p${i}`, isPaidOnly: true }),
    ),
    ...Array.from({ length: 5 }, (_, i) =>
      listing({ frontendQuestionId: `f${i}`, isPaidOnly: false }),
    ),
  ];
  const capped2 = applyDetailCap(mixed, 2);
  check(
    'paid-only rows do not consume the cap',
    capped2.scheduled.length === 7 && capped2.deferred === 3,
    `scheduled=${capped2.scheduled.length} deferred=${capped2.deferred}`,
  );

  const under = applyDetailCap(free.slice(0, 10), 200);
  check('an under-cap run defers nothing', under.deferred === 0 && under.scheduled.length === 10);

  console.log('\n=== work ordering (resume depends on it) ===');
  const shuffled = [
    listing({ frontendQuestionId: '30' }),
    listing({ frontendQuestionId: '2' }),
    listing({ frontendQuestionId: '11' }),
  ];
  const ordered = orderWorkList(shuffled).map((i) => i.frontendQuestionId);
  check(
    'work is ordered numerically, not lexically',
    ordered.join(',') === '2,11,30',
    ordered.join(','),
  );
  check(
    'ordering is stable across calls',
    orderWorkList(shuffled).map((i) => i.frontendQuestionId).join(',') === ordered.join(','),
  );
}

/* ---------------------------------------------------------------- *
 * sync_runs
 * ---------------------------------------------------------------- */
async function main(): Promise<void> {
  detectionChecks();
  capChecks();

  const db = adminClient();
  const created: string[] = [];

  console.log('\n=== sync_runs resume semantics ===');

  try {
    // Park any genuinely-running row so this test starts from a known state,
    // then restore it — a real interrupted sync must survive the test.
    const preexisting = await findResumableRun(db);
    if (preexisting) {
      await updateRun(db, preexisting.id, { status: 'paused-for-test' });
    }

    const none = await findResumableRun(db);
    check('no resumable run when none is running', none === null);

    // THE check this file exists for. The weekly keep-alive writes to the same
    // table the resume logic scans; without status='heartbeat' it would be read
    // as an interrupted sync and trigger a spurious resume from cursor 0.
    await writeHeartbeat(db);
    const afterHeartbeat = await findResumableRun(db);
    check(
      'a heartbeat row is NOT mistaken for a resumable run',
      afterHeartbeat === null,
      afterHeartbeat ? `found ${afterHeartbeat.id}` : 'none found',
    );

    const { data: hb } = await db
      .from('sync_runs')
      .select('id, status')
      .eq('source_id', SOURCE_ID)
      .eq('status', 'heartbeat')
      .order('started_at', { ascending: false })
      .limit(1);
    const hbRow = (hb ?? [])[0] as { id: string; status: string } | undefined;
    check('the heartbeat row was actually written', hbRow?.status === 'heartbeat');
    if (hbRow) created.push(hbRow.id);

    // A real interrupted run IS found, and its cursor is preserved.
    const run = await startRun(db);
    created.push(run.id);
    check('a new run starts at cursor 0', run.cursor === 0);

    await updateRun(db, run.id, { cursor: 37, processed: 37, failed: 1 });
    const resumed = await findResumableRun(db);
    check('an interrupted run is found', resumed?.id === run.id);
    check('its cursor is preserved for resume', resumed?.cursor === 37, `${resumed?.cursor}`);
    check('its counters are preserved', resumed?.processed === 37 && resumed?.failed === 1);

    // A completed run must not be resumed.
    await updateRun(db, run.id, { status: 'completed' });
    const afterComplete = await findResumableRun(db);
    check('a completed run is not resumable', afterComplete === null);

    // A failed run is likewise not auto-resumed by findResumableRun: only
    // 'running' qualifies, so a failure needs an explicit re-run.
    const failedRun = await startRun(db);
    created.push(failedRun.id);
    await updateRun(db, failedRun.id, { status: 'failed', error: 'test' });
    const afterFail = await findResumableRun(db);
    check('a failed run is not silently resumed', afterFail === null);

    console.log('\n=== RLS: sync_runs is service-role only ===');

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    const { createClient } = await import('@supabase/supabase-js');
    const anon = createClient(url, anonKey, { auth: { persistSession: false } });

    const { data: anonRead } = await anon.from('sync_runs').select('id').limit(1);
    check(
      'anon cannot read sync_runs (scraper errors are not public)',
      (anonRead ?? []).length === 0,
      `${(anonRead ?? []).length} row(s)`,
    );

    const { data: anonWrite } = await anon
      .from('sync_runs')
      .insert({ source_id: SOURCE_ID, status: 'running' })
      .select('id');
    check('anon cannot write sync_runs', (anonWrite ?? []).length === 0);

    if (preexisting) {
      await updateRun(db, preexisting.id, { status: 'running' });
      console.log('  ---- restored the pre-existing running row');
    }
  } finally {
    for (const id of created) {
      await db.from('sync_runs').delete().eq('id', id);
    }
    console.log('\ncleaned up test rows');
  }

  if (failures > 0) {
    console.error(`\n${failures} CHECK(S) FAILED`);
    process.exit(1);
  }
  console.log('\nALL CHECKS PASSED');
}

await main();
