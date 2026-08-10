/**
 * Sign-in migration checks, against the real database.
 *
 *   npx tsx scripts/verify-migration.mts
 *
 * Simulates a browser with anonymous localStorage sets, signs a user in, and
 * confirms all four migration rules hold: preserved timestamps, oldest-first
 * insertion, the collision union, and idempotency.
 *
 * The timestamp rule is the one that cannot be fixed after the fact — if
 * generated_at were not carried into created_at, the original ordering would be
 * gone and the trim trigger would keep an arbitrary five.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

config({ path: '.env.local', quiet: true });

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });

// Minimal localStorage stand-in so the real migration module can run in Node.
class FakeStorage implements Storage {
  private map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  clear() {
    this.map.clear();
  }
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
}
const storage = new FakeStorage();
(globalThis as unknown as { window: unknown }).window = { localStorage: storage };

const { migrateLocalSets, MIGRATED_FLAG } = await import('../src/lib/mcq/migrate');
const { STORAGE_PREFIX } = await import('../src/lib/mcq/store');

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

function makeSet(id: string, itemId: string, minutesAgo: number, answers: unknown[] = []) {
  return {
    id,
    content_item_id: itemId,
    model: `model-${id}`,
    language: 'python3',
    prompt_version: 1,
    questions: [
      {
        kind: 'approach',
        question: 'Which approach?',
        options: [{ text: 'a' }, { text: 'b' }, { text: 'c' }, { text: 'd' }],
        explanation: 'Because.',
        correct_index: 1,
      },
    ],
    answers,
    answered_at: answers.length > 0 ? new Date().toISOString() : null,
    generated_at: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
  };
}

async function makeUser(): Promise<{ id: string; db: SupabaseClient }> {
  const email = `migtest-${Date.now()}@example.invalid`;
  const password = `Pw-${crypto.randomUUID()}`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(error?.message);
  const db = createClient(URL, ANON, { auth: { persistSession: false } });
  await db.auth.signInWithPassword({ email, password });
  return { id: data.user.id, db };
}

async function main(): Promise<void> {
  const { data: items } = await admin
    .from('content_items')
    .select('id')
    .eq('visibility', 'public')
    .limit(2);
  const [itemA, itemB] = (items as Array<{ id: string }>).map((i) => i.id);

  const user = await makeUser();
  console.log('created a signed-in user\n');

  try {
    console.log('=== rule 1 + 2: timestamps preserved, oldest-first ===');
    // Three sets with distinct ages, deliberately stored newest-first.
    storage.setItem(
      `${STORAGE_PREFIX}${itemA}`,
      JSON.stringify([
        makeSet('a-new', itemA, 5, [{ selected_index: 1, correct: true }]),
        makeSet('a-mid', itemA, 60),
        makeSet('a-old', itemA, 600),
      ]),
    );
    storage.setItem(`${STORAGE_PREFIX}${itemB}`, JSON.stringify([makeSet('b-1', itemB, 30)]));

    const result = await migrateLocalSets(user.db, user.id);
    check('migration ran', !result.skipped, JSON.stringify(result));
    check('4 sets migrated', result.migratedSets === 4, `${result.migratedSets}`);
    check('2 problems touched', result.problems === 2, `${result.problems}`);

    const { data: rowsA } = await admin
      .from('mcq_sets')
      .select('model, created_at, answers, answered_at')
      .eq('user_id', user.id)
      .eq('content_item_id', itemA)
      .order('created_at', { ascending: false });
    const a = (rowsA ?? []) as Array<{
      model: string;
      created_at: string;
      answers: unknown[];
      answered_at: string | null;
    }>;

    check('all 3 sets present for problem A', a.length === 3, `${a.length}`);
    const distinct = new Set(a.map((r) => r.created_at)).size;
    check('created_at values are DISTINCT (not all now())', distinct === 3, `${distinct} distinct`);

    // The load-bearing assertion: ordering survived.
    check(
      'newest-first ordering matches the original generated_at',
      a[0]?.model === 'model-a-new' && a[2]?.model === 'model-a-old',
      a.map((r) => r.model).join(' > '),
    );

    const ages = a.map((r) => Math.round((Date.now() - Date.parse(r.created_at)) / 60_000));
    check(
      'timestamps are the ORIGINAL ones, not migration time',
      ages[0] >= 4 && ages[0] <= 7 && ages[2] >= 590 && ages[2] <= 610,
      `ages in minutes: ${ages.join(', ')}`,
    );

    console.log('\n=== answer state carried across unchanged ===');
    const answered = a.find((r) => r.model === 'model-a-new');
    check('answers survived', Array.isArray(answered?.answers) && answered!.answers.length === 1);
    check('answered_at survived', answered?.answered_at !== null);

    console.log('\n=== rule 4: idempotency ===');
    check('migrated flag set', storage.getItem(MIGRATED_FLAG) === '1');
    check(
      'per-problem keys cleared',
      storage.getItem(`${STORAGE_PREFIX}${itemA}`) === null &&
        storage.getItem(`${STORAGE_PREFIX}${itemB}`) === null,
    );

    const second = await migrateLocalSets(user.db, user.id);
    check('a second run is a no-op', second.skipped, JSON.stringify(second));

    const { count: afterRerun } = await admin
      .from('mcq_sets')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id);
    check('no duplicate rows after re-run', afterRerun === 4, `${afterRerun} rows`);

    console.log('\n=== rule 3: collision union keeps the newest five ===');
    // Simulate signing in on a second browser that has its own local sets while
    // the account already holds sets for the same problem.
    storage.clear();
    storage.setItem(
      `${STORAGE_PREFIX}${itemA}`,
      JSON.stringify([
        makeSet('c-1', itemA, 1),
        makeSet('c-2', itemA, 2),
        makeSet('c-3', itemA, 3),
        makeSet('c-4', itemA, 900),
      ]),
    );
    const third = await migrateLocalSets(user.db, user.id);
    check('second-browser migration ran', !third.skipped);

    const { data: unioned } = await admin
      .from('mcq_sets')
      .select('model, created_at')
      .eq('user_id', user.id)
      .eq('content_item_id', itemA)
      .order('created_at', { ascending: false });
    const u = (unioned ?? []) as Array<{ model: string; created_at: string }>;
    check('exactly 5 retained after the union', u.length === 5, `${u.length}`);
    check(
      'the 5 newest across BOTH sources survive',
      u[0].model === 'model-c-1' && u.every((r) => r.model !== 'model-c-4'),
      u.map((r) => r.model).join(', '),
    );
  } finally {
    await admin.auth.admin.deleteUser(user.id).catch(() => {});
    console.log('\ncleaned up test user');
  }

  console.log('');
  if (failures > 0) {
    console.log(`FAILED — ${failures} check(s)`);
    process.exit(1);
  }
  console.log('ALL CHECKS PASSED');
}

await main();
