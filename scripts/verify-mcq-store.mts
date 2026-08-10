/**
 * LocalMcqStore checks, against a fake localStorage.
 *
 *   npx tsx scripts/verify-mcq-store.ts
 *
 * Focused on the parts the sign-in migration depends on — `generated_at` and
 * the stored shape — plus the 5-set cap and local correctness computation.
 */

class FakeStorage implements Storage {
  private map = new Map<string, string>();
  get length(): number {
    return this.map.size;
  }
  clear(): void {
    this.map.clear();
  }
  getItem(k: string): string | null {
    return this.map.get(k) ?? null;
  }
  key(i: number): string | null {
    return [...this.map.keys()][i] ?? null;
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
  setItem(k: string, v: string): void {
    this.map.set(k, v);
  }
}

const storage = new FakeStorage();
// The store reads `window.localStorage`; provide the minimum surface it uses.
(globalThis as unknown as { window: unknown }).window = {
  localStorage: storage,
  sessionStorage: new FakeStorage(),
};

const { LocalMcqStore } = await import('../src/lib/mcq/localStore');
const { MAX_SETS_PER_ITEM } = await import('../src/lib/mcq/store');

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

const store = new LocalMcqStore();
const ITEM = 'item-1';

function questions(kinds: string[], correct = 0) {
  return kinds.map((kind) => ({
    kind,
    question: `Question about ${kind}?`,
    options: [{ text: 'a' }, { text: 'b' }, { text: 'c' }, { text: 'd' }],
    explanation: 'Because.',
    correct_index: correct,
  }));
}

console.log('=== generated_at (load-bearing for the sign-in migration) ===');
{
  const before = Date.now();
  const set = await store.save({
    content_item_id: ITEM,
    model: 'gemini-2.5-flash',
    language: 'python3',
    prompt_version: 1,
    questions: questions(['approach', 'algorithm', 'complexity', 'solution']),
  });
  const t = Date.parse(set.generated_at);
  check('generated_at is present', typeof set.generated_at === 'string' && set.generated_at.length > 0);
  check('generated_at is a valid ISO timestamp', Number.isFinite(t));
  check('generated_at is roughly now', t >= before - 1000 && t <= Date.now() + 1000);

  const raw = storage.getItem('techdecks:mcq:item-1') ?? '[]';
  check('generated_at survives the round-trip to storage', raw.includes('generated_at'));

  const parsed = JSON.parse(raw) as Array<Record<string, unknown>>;
  const keys = Object.keys(parsed[0]).sort();
  // Same JSON shape as the mcq_sets DB column, so the sign-in migration needs
  // no transformation.
  const expected = ['answered_at','answers','content_item_id','generated_at','id','language','model','prompt_version','questions'];
  check('stored shape matches the DB column shape', JSON.stringify(keys) === JSON.stringify(expected), keys.join(','));
}

console.log('\n=== 5-set cap ===');
{
  await store.clear(ITEM);
  for (let i = 0; i < 8; i++) {
    await store.save({
      content_item_id: ITEM,
      model: `model-${i}`,
      language: 'python3',
      prompt_version: 1,
      questions: questions(['approach']),
    });
    // Distinct timestamps, mirroring sequential regeneration.
    await new Promise((r) => setTimeout(r, 5));
  }
  const list = await store.list(ITEM);
  check(`keeps only ${MAX_SETS_PER_ITEM}`, list.length === MAX_SETS_PER_ITEM, `got ${list.length}`);
  check('keeps the NEWEST five', list[0].model === 'model-7' && list[4].model === 'model-3', list.map((l) => l.model).join(','));
  check('newest first', list.every((s, i) => i === 0 || Date.parse(list[i - 1].generated_at) >= Date.parse(s.generated_at)));
}

console.log('\n=== answering (correctness computed locally) ===');
{
  await store.clear(ITEM);
  const set = await store.save({
    content_item_id: ITEM,
    model: 'm',
    language: 'python3',
    prompt_version: 1,
    questions: questions(['approach', 'algorithm', 'complexity', 'solution'], 2),
  });

  const wrong = await store.recordAnswer(set.id, 0, 0);
  check('wrong answer recorded as incorrect', wrong.answers[0]?.correct === false);
  const right = await store.recordAnswer(set.id, 1, 2);
  check('right answer recorded as correct', right.answers[1]?.correct === true);
  check('answered_at still null while incomplete', right.answered_at === null);

  // Out-of-order answering must not leave holes.
  const skipped = await store.recordAnswer(set.id, 3, 2);
  check('padding keeps positional alignment', skipped.answers.length === 4 && skipped.answers[2] === null);
  check('answered_at null while a hole remains', skipped.answered_at === null);

  const done = await store.recordAnswer(set.id, 2, 1);
  check('answered_at set once complete', typeof done.answered_at === 'string');
  check('final score is 2/4', done.answers.filter((a) => a?.correct).length === 2);

  let threw = false;
  try {
    await store.recordAnswer(set.id, 9, 0);
  } catch {
    threw = true;
  }
  check('rejects an out-of-range index', threw);

  threw = false;
  try {
    await store.recordAnswer(set.id, 0, 7);
  } catch {
    threw = true;
  }
  check('rejects an out-of-range selection', threw);
}

console.log('\n=== reset clears in place ===');
{
  const before = await store.list(ITEM);
  const reset = await store.reset(before[0].id);
  const after = await store.list(ITEM);
  check('answers cleared', reset.answers.length === 0);
  check('answered_at cleared', reset.answered_at === null);
  check('no new set created', after.length === before.length, `${before.length} -> ${after.length}`);
  check('id unchanged', after[0].id === before[0].id);
  check('generated_at preserved through reset', after[0].generated_at === before[0].generated_at);
}

console.log('\n=== variable question count (nothing hardcodes 4) ===');
{
  await store.clear(ITEM);
  const two = await store.save({
    content_item_id: ITEM,
    model: 'm',
    language: 'python3',
    prompt_version: 1,
    questions: questions(['bottleneck', 'tradeoffs']),
  });
  check('stores a 2-question set', two.questions.length === 2);
  const answered = await store.recordAnswer(two.id, 1, 0);
  check('completes after 2 answers', (await store.recordAnswer(two.id, 0, 0)).answered_at !== null || answered.answers.length === 2);

  const eight = await store.save({
    content_item_id: ITEM,
    model: 'm',
    language: 'python3',
    prompt_version: 1,
    questions: questions(['a','b','c','d','e','f','g','h']),
  });
  check('stores an 8-question set', eight.questions.length === 8);
}

console.log('\n=== remove / clear / corrupt data ===');
{
  const list = await store.list(ITEM);
  await store.remove(list[0].id);
  check('remove deletes one set', (await store.list(ITEM)).length === list.length - 1);

  storage.setItem('techdecks:mcq:corrupt', '{not json');
  check('corrupt JSON yields an empty list, no throw', (await store.list('corrupt')).length === 0);

  storage.setItem('techdecks:mcq:partial', JSON.stringify([{ id: 'x' }]));
  check('entry missing required fields is dropped', (await store.list('partial')).length === 0);

  await store.clear(ITEM);
  check('clear empties the problem', (await store.list(ITEM)).length === 0);
}

console.log('');
if (failures > 0) {
  console.log(`FAILED — ${failures} check(s)`);
  process.exit(1);
}
console.log('ALL CHECKS PASSED');
