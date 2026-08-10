/**
 * Search: ranking, the trigram fallback, filters, and RLS, against the real
 * database.
 *
 *   npx tsx scripts/verify-search.mts
 *
 * Filter counts are checked against a DIRECT SQL count rather than against the
 * RPC's own total — a self-consistent wrong answer would otherwise pass.
 *
 * Cleans up after itself.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { searchContentItems, fetchTagCounts, createAuthoredProblem } from '../src/lib/queries';
import { filtersFromParams, paramsFromFilters, searchHref } from '../src/lib/searchParams';
import { EMPTY_FILTERS, filtersAreEmpty, type SearchFilters } from '../src/lib/types';

config({ path: '.env.local', quiet: true });

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!URL_ || !ANON || !SERVICE) throw new Error('missing Supabase env vars');

const admin = createClient(URL_, SERVICE, { auth: { persistSession: false } });
const anon = createClient(URL_, ANON, { auth: { persistSession: false } });

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

const F = (over: Partial<SearchFilters> = {}): SearchFilters => ({ ...EMPTY_FILTERS, ...over });

async function makeUser(label: string): Promise<{ id: string; db: SupabaseClient }> {
  const email = `searchtest-${label}-${Date.now()}@example.invalid`;
  const password = `Pw-${crypto.randomUUID()}`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`could not create ${label}: ${error?.message}`);
  const db = createClient(URL_, ANON, { auth: { persistSession: false } });
  const { error: signInErr } = await db.auth.signInWithPassword({ email, password });
  if (signInErr) throw new Error(`could not sign in ${label}: ${signInErr.message}`);
  return { id: data.user.id, db };
}

/* ---------------------------------------------------------------- *
 * URL round-tripping (no DB)
 * ---------------------------------------------------------------- */
function paramChecks(): void {
  console.log('\n=== filter URL round-trip ===');

  const full = F({
    q: 'two sum',
    difficulties: ['easy', 'hard'],
    tags: ['array', 'hash-table'],
    acMin: 20,
    acMax: 80,
    bookmarkedOnly: true,
  });
  const back = filtersFromParams(paramsFromFilters(full));
  check('filters survive a URL round-trip', JSON.stringify(back) === JSON.stringify(full));

  check('empty filters produce a bare /search', searchHref(EMPTY_FILTERS) === '/search');
  check('filtersAreEmpty agrees', filtersAreEmpty(EMPTY_FILTERS) && !filtersAreEmpty(full));

  // These params are user-editable text in an address bar, so parsing must be
  // total rather than throwing.
  const junk = filtersFromParams(new URLSearchParams('difficulty=purple&acMin=abc&acMax=999'));
  check('unknown difficulty is dropped', junk.difficulties.length === 0);
  check('non-numeric acMin becomes null', junk.acMin === null);
  check('out-of-range acMax becomes null', junk.acMax === null);

  const inverted = filtersFromParams(new URLSearchParams('acMin=90&acMax=10'));
  check(
    'an inverted range is swapped, not left matching nothing',
    inverted.acMin === 10 && inverted.acMax === 90,
    `${inverted.acMin}-${inverted.acMax}`,
  );

  const dupes = filtersFromParams(new URLSearchParams('tags=array,array,tree'));
  check('duplicate tags are collapsed', dupes.tags.length === 2, dupes.tags.join(','));
}

/* ---------------------------------------------------------------- *
 * Search behaviour
 * ---------------------------------------------------------------- */
async function main(): Promise<void> {
  paramChecks();

  console.log('\n=== full-text ranking ===');

  const exact = await searchContentItems(anon, F({ q: 'two sum' }));
  check('"two sum" returns hits', exact.hits.length > 0, `${exact.total} total`);
  check(
    '"two sum" ranks Two Sum first',
    exact.hits[0]?.slug === 'two-sum',
    exact.hits[0]?.title ?? '(none)',
  );

  const topic = await searchContentItems(anon, F({ q: 'binary search tree' }));
  check('a topical query returns hits', topic.hits.length > 0, `${topic.total} total`);

  // The plan's headline P5 check: the typo path.
  console.log('\n=== trigram fallback ===');

  const ts = await searchContentItems(anon, F({ q: 'two sim' }));
  check('"two sim" returns hits at all (fallback fired)', ts.hits.length > 0, `${ts.total} total`);
  check(
    '"two sim" ranks Two Sum first',
    ts.hits[0]?.slug === 'two-sum',
    ts.hits[0]?.title ?? '(none)',
  );

  const nonsense = await searchContentItems(anon, F({ q: 'zzzzqqqqxxxx' }));
  check('nonsense returns nothing', nonsense.hits.length === 0, `${nonsense.total}`);

  // A query of pure stopwords yields an empty tsquery; it must degrade to a
  // browse rather than to zero results.
  const stop = await searchContentItems(anon, F({ q: 'the' }));
  check('a stopword-only query does not error', stop.total >= 0);

  // Punctuation must not throw the way to_tsquery would.
  const punct = await searchContentItems(anon, F({ q: 'c++ & <>' }));
  check('punctuation does not error', punct.total >= 0, `${punct.total} total`);

  console.log('\n=== filters vs direct SQL ===');

  // Difficulty alone.
  const easy = await searchContentItems(anon, F({ difficulties: ['easy'] }), 1);
  const { count: easyCount } = await admin
    .from('content_items')
    .select('id', { count: 'exact', head: true })
    .eq('visibility', 'public')
    .eq('difficulty', 'easy')
    .not('body_html', 'is', null);
  check(
    'difficulty=easy count matches direct SQL',
    easy.total === easyCount,
    `rpc=${easy.total} sql=${easyCount}`,
  );

  // Tag + difficulty combined — the plan's explicit P5 check.
  const { data: tagRow } = await admin.from('tags').select('id, slug').eq('slug', 'array').single();
  const arrayTagId = (tagRow as { id: string }).id;

  // Paged explicitly: PostgREST caps a bare select at 1000 rows without saying
  // so, and `array` has 2196 joins. Reading it in one shot would compare the
  // RPC against a silently truncated count — a check that measures less than it
  // claims is worse than no check.
  const ids: string[] = [];
  for (let from = 0; ; from += 1000) {
    const { data: chunk, error: chunkErr } = await admin
      .from('content_item_tags')
      .select('content_item_id')
      .eq('tag_id', arrayTagId)
      .range(from, from + 999);
    if (chunkErr) throw new Error(`tag join read failed: ${chunkErr.message}`);
    const rows = (chunk ?? []) as Array<{ content_item_id: string }>;
    ids.push(...rows.map((r) => r.content_item_id));
    if (rows.length < 1000) break;
  }

  // Count array+medium directly, in chunks — `in` has a URL length ceiling.
  let sqlCombined = 0;
  for (let i = 0; i < ids.length; i += 200) {
    const { count } = await admin
      .from('content_items')
      .select('id', { count: 'exact', head: true })
      .in('id', ids.slice(i, i + 200))
      .eq('visibility', 'public')
      .eq('difficulty', 'medium')
      .not('body_html', 'is', null);
    sqlCombined += count ?? 0;
  }

  const combined = await searchContentItems(
    anon,
    F({ tags: ['array'], difficulties: ['medium'] }),
    1,
  );
  check(
    'tag=array + difficulty=medium matches direct SQL',
    combined.total === sqlCombined,
    `rpc=${combined.total} sql=${sqlCombined}`,
  );

  // Multiple tags must NARROW, not widen.
  const oneTag = await searchContentItems(anon, F({ tags: ['array'] }), 1);
  const twoTags = await searchContentItems(anon, F({ tags: ['array', 'dynamic-programming'] }), 1);
  check(
    'adding a second tag narrows the result set',
    twoTags.total < oneTag.total && twoTags.total > 0,
    `${oneTag.total} -> ${twoTags.total}`,
  );

  // acRate range.
  const band = await searchContentItems(anon, F({ acMin: 60, acMax: 70 }), 100);
  const outside = band.hits.filter((h) => {
    const ac = h.metadata.acRate;
    return typeof ac !== 'number' || ac < 60 || ac > 70;
  });
  check('every acRate hit is inside the band', outside.length === 0, `${outside.length} outside`);
  check('the acRate band returns something', band.total > 0, `${band.total} total`);

  console.log('\n=== paid-only exclusion ===');

  const { count: paidCount } = await admin
    .from('content_items')
    .select('id', { count: 'exact', head: true })
    .is('body_html', null);
  const browse = await searchContentItems(anon, F(), 1);
  const { count: publicWithBody } = await admin
    .from('content_items')
    .select('id', { count: 'exact', head: true })
    .eq('visibility', 'public')
    .not('body_html', 'is', null);
  check(
    'an unfiltered browse excludes paid-only rows',
    browse.total === publicWithBody,
    `rpc=${browse.total} sql=${publicWithBody} (paid-only=${paidCount})`,
  );

  console.log('\n=== pagination ===');

  const p1 = await searchContentItems(anon, F({ difficulties: ['easy'] }), 5, 0);
  const p2 = await searchContentItems(anon, F({ difficulties: ['easy'] }), 5, 5);
  check('page 1 returns the requested size', p1.hits.length === 5, `${p1.hits.length}`);
  check('page 2 does not repeat page 1', !p2.hits.some((h) => p1.hits.some((x) => x.id === h.id)));
  check('both pages report the same total', p1.total === p2.total, `${p1.total}/${p2.total}`);

  const clamped = await searchContentItems(anon, F(), 5000, 0);
  check('an oversized limit is clamped', clamped.hits.length <= 100, `${clamped.hits.length}`);

  console.log('\n=== tag counts ===');

  const tagCounts = await fetchTagCounts(anon);
  check('tag list is non-empty', tagCounts.length > 0, `${tagCounts.length} tags`);
  check(
    'tag counts are sorted most-used first',
    tagCounts.every((t, i) => i === 0 || tagCounts[i - 1].count >= t.count),
  );
  check('every listed tag has at least one item', tagCounts.every((t) => t.count > 0));

  // ---- the security property ----
  console.log('\n=== RLS: search must not leak private rows ===');

  const alice = await makeUser('alice');
  const bob = await makeUser('bob');
  const created: string[] = [];

  try {
    const secret = await createAuthoredProblem(alice.db, alice.id, {
      title: 'Zqxjv Private Marker Problem',
      body: 'A private authored problem with a distinctive title.',
      difficulty: 'hard',
      tags: [],
      language: null,
      kinds: ['approach'],
    });
    created.push(secret.id);

    const aliceSees = await searchContentItems(alice.db, F({ q: 'Zqxjv Private Marker' }));
    check(
      'A finds their OWN authored problem',
      aliceSees.hits.some((h) => h.id === secret.id),
      `${aliceSees.total} hit(s)`,
    );

    const bobSees = await searchContentItems(bob.db, F({ q: 'Zqxjv Private Marker' }));
    check(
      "B cannot find A's authored problem",
      !bobSees.hits.some((h) => h.id === secret.id),
      `${bobSees.total} hit(s)`,
    );

    const anonSees = await searchContentItems(anon, F({ q: 'Zqxjv Private Marker' }));
    check(
      'anon cannot find it either',
      !anonSees.hits.some((h) => h.id === secret.id),
      `${anonSees.total} hit(s)`,
    );

    // The trigram fallback is a second query path and must be equally scoped —
    // a definer-mode fallback would leak here even if the precise path did not.
    const bobFuzzy = await searchContentItems(bob.db, F({ q: 'Zqxjv Privat Marker Problm' }));
    check(
      "the trigram fallback does not leak A's row to B",
      !bobFuzzy.hits.some((h) => h.id === secret.id),
      `${bobFuzzy.total} hit(s)`,
    );

    // bookmarked-only, and that it is scoped per user.
    const { data: pub } = await admin
      .from('content_items')
      .select('id')
      .eq('visibility', 'public')
      .not('body_html', 'is', null)
      .limit(1)
      .single();
    const pubId = (pub as { id: string }).id;

    await alice.db.from('bookmarks').insert({ user_id: alice.id, content_item_id: pubId });

    const aliceMarked = await searchContentItems(alice.db, F({ bookmarkedOnly: true }));
    check(
      'bookmarked-only returns A’s bookmark',
      aliceMarked.hits.some((h) => h.id === pubId),
      `${aliceMarked.total} hit(s)`,
    );

    const bobMarked = await searchContentItems(bob.db, F({ bookmarkedOnly: true }));
    check("bookmarked-only is empty for B", bobMarked.total === 0, `${bobMarked.total} hit(s)`);

    const anonMarked = await searchContentItems(anon, F({ bookmarkedOnly: true }));
    check('bookmarked-only is empty for anon', anonMarked.total === 0, `${anonMarked.total}`);
  } finally {
    for (const id of created) await admin.from('content_items').delete().eq('id', id);
    await admin.auth.admin.deleteUser(alice.id);
    await admin.auth.admin.deleteUser(bob.id);
    console.log('\ncleaned up test users');
  }

  if (failures > 0) {
    console.error(`\n${failures} CHECK(S) FAILED`);
    process.exit(1);
  }
  console.log('\nALL CHECKS PASSED');
}

await main();
