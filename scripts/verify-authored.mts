/**
 * Authored problems, bookmarks, and the variable-kind path, against the real
 * database.
 *
 *   npx tsx scripts/verify-authored.mts
 *
 * Everything here is checked through the API as a real, signed-in user — RLS is
 * verified by a second user querying directly, never by trusting that the UI
 * hides a row.
 *
 * Cleans up after itself.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { markdownToHtml } from '../src/lib/markdown';
import { sanitizeProblemHtml } from '../src/lib/sanitizeNode';
import { kindsForItem } from '../src/lib/gemini/schema';
import {
  createAuthoredProblem,
  deleteAuthoredProblem,
  fetchBookmarks,
  fetchMyProblems,
  generateUniqueSlug,
  slugifyTitle,
  updateAuthoredProblem,
  addBookmark,
  removeBookmark,
  fetchFeedPage,
} from '../src/lib/queries';

config({ path: '.env.local', quiet: true });

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!URL || !ANON || !SERVICE) throw new Error('missing Supabase env vars');

const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

type TestUser = { id: string; db: SupabaseClient };

async function makeUser(label: string): Promise<TestUser> {
  const email = `authored-${label}-${Date.now()}@example.invalid`;
  const password = `Pw-${crypto.randomUUID()}`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`could not create ${label}: ${error?.message}`);

  const db = createClient(URL, ANON, { auth: { persistSession: false } });
  const { error: signInErr } = await db.auth.signInWithPassword({ email, password });
  if (signInErr) throw new Error(`could not sign in ${label}: ${signInErr.message}`);
  return { id: data.user.id, db };
}

/* ---------------------------------------------------------------- *
 * Markdown + sanitizer (no DB)
 * ---------------------------------------------------------------- */

function markdownChecks(): void {
  console.log('\n=== markdown renderer ===');

  const html = markdownToHtml('# Title\n\nSome **bold** and `code`.\n\n- one\n- two');
  check('heading renders', html.includes('<h1>Title</h1>'), html.slice(0, 40));
  check('bold renders', html.includes('<strong>bold</strong>'));
  check('inline code renders', html.includes('<code>code</code>'));
  check('list renders', html.includes('<ul>') && html.includes('<li>one</li>'));

  const fenced = markdownToHtml('```python\nprint("hi")\n```');
  check('fence renders as pre/code', fenced.includes('<pre><code class="language-python">'));
  check('fence body is escaped', fenced.includes('&quot;hi&quot;'), fenced);

  // The security property: markdown is untrusted, exactly like scraped HTML.
  const xss = markdownToHtml('Hello <script>alert(1)</script> world');
  check('raw script tag is escaped, not emitted', !xss.includes('<script'), xss);
  check(
    'sanitizer agrees after conversion',
    !(sanitizeProblemHtml(xss) ?? '').includes('<script'),
  );

  const jsLink = markdownToHtml('[click](javascript:alert(1))');
  check('javascript: link is not made into an anchor', !jsLink.includes('<a href'), jsLink);

  const fenceXss = markdownToHtml('```\n<img src=x onerror=alert(1)>\n```');
  check('html inside a fence stays literal', !fenceXss.includes('<img'), fenceXss);

  // A code span must not be re-parsed as emphasis.
  const span = markdownToHtml('use `a ** b` here');
  check('emphasis inside a code span is inert', span.includes('<code>a ** b</code>'), span);

  // A body containing the plain-text sentinel must not be corrupted.
  const sentinel = markdownToHtml('literally CODE0 and `x`');
  check(
    'a body containing "CODE0" survives intact',
    sentinel.includes('literally CODE0 and <code>x</code>'),
    sentinel,
  );

  check('slugify strips punctuation', slugifyTitle('Two Sum!! (Hard)') === 'two-sum-hard');
  check('slugify handles accents', slugifyTitle('Café Order') === 'cafe-order');
  check('slugify of pure punctuation is empty', slugifyTitle('!!!') === '');
}

/* ---------------------------------------------------------------- *
 * Kind derivation (no DB)
 * ---------------------------------------------------------------- */

function kindChecks(): void {
  console.log('\n=== kind derivation ===');

  const synced = kindsForItem({
    source_id: 'leetcode',
    metadata: { codeSnippets: [{ lang: 'Python3', langSlug: 'python3', code: 'x' }] },
  });
  check(
    'synced problem always gets the preset four in order',
    synced.kinds.join(',') === 'approach,algorithm,complexity,solution',
    synced.kinds.join(','),
  );
  check('synced problem with codeSnippets is grounded', synced.grounded);

  const syncedNoSnippets = kindsForItem({ source_id: 'leetcode', metadata: {} });
  check('synced problem without codeSnippets is ungrounded', !syncedNoSnippets.grounded);

  const authored = kindsForItem({
    source_id: 'user',
    metadata: { kinds: ['Bottleneck', 'Tradeoffs', 'Failure Modes'] },
  });
  check(
    'authored kinds pass through in order',
    authored.kinds.join(',') === 'Bottleneck,Tradeoffs,Failure Modes',
    authored.kinds.join(','),
  );
  check('authored problems are always ungrounded', !authored.grounded);

  const overflow = kindsForItem({
    source_id: 'user',
    metadata: { kinds: Array.from({ length: 12 }, (_, i) => `k${i}`) },
  });
  check('authored kinds are capped at 8', overflow.kinds.length === 8, `${overflow.kinds.length}`);

  const empty = kindsForItem({ source_id: 'user', metadata: {} });
  check('authored problem with no kinds falls back to presets', empty.kinds.length === 4);
}

/* ---------------------------------------------------------------- *
 * The database-backed checks
 * ---------------------------------------------------------------- */

async function main(): Promise<void> {
  markdownChecks();
  kindChecks();

  const alice = await makeUser('alice');
  const bob = await makeUser('bob');
  const created: string[] = [];

  try {
    console.log('\n=== authored problem CRUD ===');

    const item = await createAuthoredProblem(alice.db, alice.id, {
      title: 'Rate Limiter Design',
      body: '# Design a rate limiter\n\nSupport **burst** traffic.',
      difficulty: 'medium',
      tags: ['array'],
      language: null,
      kinds: ['Bottleneck', 'Tradeoffs', 'Failure Modes'],
    });
    created.push(item.id);

    check('created with source_id=user', item.source_id === 'user', item.source_id);
    check('created private', item.visibility === 'private', item.visibility);
    check('owner is the author', item.owner_id === alice.id);
    check('body_format is markdown', item.body_format === 'markdown', item.body_format);
    check('external_id is null', item.external_id === null);
    check('sort_key is null', item.sort_key === null);
    check(
      'kinds round-trip through metadata',
      (item.metadata.kinds ?? []).join(',') === 'Bottleneck,Tradeoffs,Failure Modes',
    );

    // topic_text feeds the generated search_vector and MUST agree with the tag
    // joins — the exact drift the seed hit when the two were written apart.
    const { data: joinRows } = await admin
      .from('content_item_tags')
      .select('tags ( slug )')
      .eq('content_item_id', item.id);
    // PostgREST nests the embedded tag one level deeper than the flat shape
    // here wants, and types it as an array; flatten both forms.
    const joined = ((joinRows ?? []) as unknown as Array<{
      tags: { slug: string } | Array<{ slug: string }> | null;
    }>)
      .flatMap((r) => (Array.isArray(r.tags) ? r.tags : r.tags ? [r.tags] : []))
      .map((t) => t.slug);
    check('tag join row was written', joined.length === 1, joined.join(','));
    check(
      'metadata.topic_text agrees with the tag joins',
      (item.metadata.topic_text ?? '') === 'array',
      item.metadata.topic_text ?? '(none)',
    );

    // --- slug collision, the rule that matters ---
    console.log('\n=== slug collision against public rows ===');

    const twoSum = await createAuthoredProblem(alice.db, alice.id, {
      title: 'Two Sum',
      body: 'My own take on it.',
      difficulty: 'easy',
      tags: [],
      language: 'python',
      kinds: ['approach'],
    });
    created.push(twoSum.id);

    check(
      'authored "Two Sum" does NOT take the public slug',
      twoSum.slug !== 'two-sum',
      twoSum.slug,
    );
    check('it is suffixed instead', /^two-sum-\d+$/.test(twoSum.slug), twoSum.slug);

    // The residual tiebreak: even with both rows visible to Alice, the public
    // row must win a bare slug lookup.
    const { data: bySlug } = await alice.db
      .from('content_items')
      .select('id, owner_id, visibility')
      .eq('slug', 'two-sum')
      .order('owner_id', { ascending: true, nullsFirst: true })
      .limit(1);
    const winner = (bySlug ?? [])[0] as { owner_id: string | null; visibility: string } | undefined;
    check(
      'a bare /problems/two-sum lookup still resolves to the PUBLIC row',
      winner?.visibility === 'public' && winner.owner_id === null,
      winner ? `${winner.visibility}/${winner.owner_id ?? 'null'}` : 'no row',
    );

    // An edit keeping its title must not collide with itself.
    const renamed = await updateAuthoredProblem(
      alice.db,
      alice.id,
      twoSum.id,
      twoSum.slug,
      twoSum.title,
      {
        title: 'Two Sum',
        body: 'Edited body.',
        difficulty: 'easy',
        tags: [],
        language: 'python',
        kinds: ['approach', 'complexity'],
      },
    );
    check('editing without a title change keeps the slug', renamed.slug === twoSum.slug);
    check('edited kinds are persisted', (renamed.metadata.kinds ?? []).length === 2);

    // A second problem by the same title as Alice's first must also suffix.
    const dupe = await generateUniqueSlug(alice.db, alice.id, 'Rate Limiter Design');
    check('a repeat authored title suffixes', dupe === 'rate-limiter-design-2', dupe);

    // --- isolation: this is the check the UI cannot make ---
    console.log('\n=== cross-user isolation (direct API, as user B) ===');

    const { data: bobSees } = await bob.db
      .from('content_items')
      .select('id')
      .eq('id', item.id);
    check(
      "B cannot read A's authored problem",
      (bobSees ?? []).length === 0,
      `${(bobSees ?? []).length} row(s)`,
    );

    const bobMine = await fetchMyProblems(bob.db);
    check("B's /my list is empty", bobMine.length === 0, `${bobMine.length} row(s)`);

    const { error: bobUpdateErr, data: bobUpdated } = await bob.db
      .from('content_items')
      .update({ title: 'hijacked' })
      .eq('id', item.id)
      .select('id');
    check(
      "B cannot update A's problem",
      (bobUpdated ?? []).length === 0,
      bobUpdateErr ? bobUpdateErr.code : `${(bobUpdated ?? []).length} row(s) updated`,
    );

    const { data: bobDeleted } = await bob.db
      .from('content_items')
      .delete()
      .eq('id', item.id)
      .select('id');
    check(
      "B cannot delete A's problem",
      (bobDeleted ?? []).length === 0,
      `${(bobDeleted ?? []).length} row(s) deleted`,
    );

    // The policy pins visibility and source_id, not just owner_id — otherwise a
    // user could PATCH their row into the synced namespace.
    const { data: escalated } = await alice.db
      .from('content_items')
      .update({ source_id: 'leetcode' })
      .eq('id', item.id)
      .select('id');
    check(
      'A cannot move their own row into the leetcode namespace',
      (escalated ?? []).length === 0,
      `${(escalated ?? []).length} row(s) updated`,
    );

    const { data: madePublic } = await alice.db
      .from('content_items')
      .update({ visibility: 'public' })
      .eq('id', item.id)
      .select('id');
    check(
      'A cannot make their own row public',
      (madePublic ?? []).length === 0,
      `${(madePublic ?? []).length} row(s) updated`,
    );

    // --- feed exclusion ---
    console.log('\n=== feed exclusion ===');

    const feed = await fetchFeedPage(alice.db, null, 50);
    check(
      "A's own authored problems do not appear in the public feed",
      !feed.items.some((f) => f.id === item.id || f.id === twoSum.id),
    );
    check(
      'the feed still returns public rows',
      feed.items.length > 0 && feed.items.every((f) => f.visibility === 'public'),
      `${feed.items.length} row(s)`,
    );
    check(
      'no paid-only blanks in the feed',
      feed.items.every((f) => f.body_html !== null),
    );

    // --- bookmarks ---
    console.log('\n=== bookmarks ===');

    const { data: publicRow } = await admin
      .from('content_items')
      .select('id')
      .eq('visibility', 'public')
      .not('body_html', 'is', null)
      .limit(1)
      .single();
    const publicId = (publicRow as { id: string }).id;

    await addBookmark(alice.db, alice.id, publicId);
    let marks = await fetchBookmarks(alice.db);
    check('A can bookmark a public problem', marks.some((m) => m.id === publicId));

    // Re-bookmarking must be idempotent, not a primary-key error.
    await addBookmark(alice.db, alice.id, publicId);
    marks = await fetchBookmarks(alice.db);
    check('re-bookmarking does not duplicate', marks.filter((m) => m.id === publicId).length === 1);

    const bobMarks = await fetchBookmarks(bob.db);
    check("B cannot see A's bookmarks", bobMarks.length === 0, `${bobMarks.length} row(s)`);

    const { data: bobForged } = await bob.db
      .from('bookmarks')
      .insert({ user_id: alice.id, content_item_id: publicId })
      .select('user_id');
    check('B cannot write a bookmark as A', (bobForged ?? []).length === 0);

    await addBookmark(alice.db, alice.id, item.id);
    const withAuthored = await fetchBookmarks(alice.db);
    check(
      'an authored problem can be bookmarked and read back',
      withAuthored.some((m) => m.id === item.id),
    );

    await removeBookmark(alice.db, alice.id, publicId);
    marks = await fetchBookmarks(alice.db);
    check('removing a bookmark works', !marks.some((m) => m.id === publicId));

    // --- delete cascades ---
    console.log('\n=== delete cascades generated sets ===');

    const { error: setErr } = await alice.db.from('mcq_sets').insert({
      content_item_id: item.id,
      user_id: alice.id,
      model: 'test-model',
      language: 'text',
      prompt_version: 1,
      questions: [
        {
          kind: 'Bottleneck',
          question: 'Where does it bottleneck under burst load?',
          options: [{ text: 'a' }, { text: 'b' }, { text: 'c' }, { text: 'd' }],
          explanation: 'Because the token bucket drains.',
          correct_index: 1,
        },
      ],
      answers: [],
    });
    check('a 1-question set is accepted (nothing requires 4)', !setErr, setErr?.message ?? '');

    await deleteAuthoredProblem(alice.db, alice.id, item.id);
    created.splice(created.indexOf(item.id), 1);

    const { data: orphanSets } = await admin
      .from('mcq_sets')
      .select('id')
      .eq('content_item_id', item.id);
    check(
      'deleting the problem cascades its sets',
      (orphanSets ?? []).length === 0,
      `${(orphanSets ?? []).length} orphan(s)`,
    );

    const { data: orphanBookmarks } = await admin
      .from('bookmarks')
      .select('user_id')
      .eq('content_item_id', item.id);
    check(
      'deleting the problem cascades its bookmarks',
      (orphanBookmarks ?? []).length === 0,
      `${(orphanBookmarks ?? []).length} orphan(s)`,
    );
  } finally {
    for (const id of created) {
      await admin.from('content_items').delete().eq('id', id);
    }
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
