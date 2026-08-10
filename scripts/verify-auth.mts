/**
 * Cross-user isolation and Vault checks, against the real database.
 *
 *   npx tsx scripts/verify-auth.mts
 *
 * Creates two real auth users, signs in as each, and exercises the paths the UI
 * cannot verify — RLS is tested through the API as a second user, never by
 * checking that the interface hides something.
 *
 * Cleans up after itself.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

config({ path: '.env.local', quiet: true });

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!URL || !ANON || !SERVICE) throw new Error('missing Supabase env vars');

const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });

/**
 * Count a vault secret by id.
 *
 * vault.secrets is NOT reachable through PostgREST — the schema is deliberately
 * unexposed, which is correct — so this goes through a service-role-only SQL
 * helper. Returns null when that helper has not been applied, so a missing
 * migration reads as SKIP rather than a false pass.
 */
async function vaultSecretCount(id: string): Promise<number | null> {
  const { data, error } = await admin.rpc('audit_vault_secret_exists', { p_id: id });
  if (error || typeof data !== 'number') return null;
  return data;
}

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

type TestUser = { id: string; email: string; password: string; db: SupabaseClient };

async function makeUser(label: string): Promise<TestUser> {
  const email = `authtest-${label}-${Date.now()}@example.invalid`;
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

  return { id: data.user.id, email, password, db };
}

const QUESTIONS = [
  {
    kind: 'approach',
    question: 'Which approach fits?',
    options: [{ text: 'a' }, { text: 'b' }, { text: 'c' }, { text: 'd' }],
    explanation: 'Because.',
    correct_index: 2,
  },
  {
    kind: 'algorithm',
    question: 'Which algorithm is optimal?',
    options: [{ text: 'a' }, { text: 'b' }, { text: 'c' }, { text: 'd' }],
    explanation: 'Because.',
    correct_index: 0,
  },
];

async function main(): Promise<void> {
  const { data: item } = await admin
    .from('content_items')
    .select('id')
    .eq('visibility', 'public')
    .limit(1)
    .single();
  const itemId = (item as { id: string }).id;

  const alice = await makeUser('alice');
  const bob = await makeUser('bob');
  console.log(`created two users\n`);

  try {
    console.log('=== mcq_sets: insert as A, invisible to B ===');
    const { data: setRow, error: insErr } = await alice.db
      .from('mcq_sets')
      .insert({
        content_item_id: itemId,
        user_id: alice.id,
        model: 'test',
        language: 'python3',
        questions: QUESTIONS,
      })
      .select('id')
      .single();
    check('A can insert her own set', !insErr, insErr?.message);
    const setId = (setRow as { id: string } | null)?.id ?? '';

    const { data: bobSees } = await bob.db.from('mcq_sets').select('id').eq('id', setId);
    check("B cannot read A's set", (bobSees?.length ?? 0) === 0, `saw ${bobSees?.length} row(s)`);

    const { error: spoofErr } = await bob.db.from('mcq_sets').insert({
      content_item_id: itemId,
      user_id: alice.id, // impersonation attempt
      model: 'spoof',
      language: 'python3',
      questions: QUESTIONS,
    });
    check('B cannot insert a set owned by A', Boolean(spoofErr), spoofErr?.code);

    console.log('\n=== correctness is computed in SQL ===');
    const { data: rpc1, error: rpcErr } = await alice.db.rpc('record_answer', {
      p_set_id: setId,
      p_index: 0,
      p_selected: 2,
    });
    check('A can answer her own set', !rpcErr, rpcErr?.message);
    check(
      'correct selection recorded as correct',
      (rpc1 as { correct?: boolean } | null)?.correct === true,
      JSON.stringify(rpc1),
    );

    const { data: rpc2 } = await alice.db.rpc('record_answer', {
      p_set_id: setId,
      p_index: 1,
      p_selected: 3,
    });
    check(
      'wrong selection recorded as incorrect',
      (rpc2 as { correct?: boolean } | null)?.correct === false,
    );

    const { data: after } = await alice.db
      .from('mcq_sets')
      .select('answers, answered_at')
      .eq('id', setId)
      .single();
    const row = after as { answers: Array<{ correct: boolean }>; answered_at: string | null };
    check('answered_at set once complete', row.answered_at !== null);
    check('answers hold DB-computed correctness', row.answers[0].correct === true && row.answers[1].correct === false);

    console.log('\n=== the checks the UI cannot make ===');
    const { error: bobRpcErr } = await bob.db.rpc('record_answer', {
      p_set_id: setId,
      p_index: 0,
      p_selected: 0,
    });
    check("B calling record_answer on A's set raises", Boolean(bobRpcErr), bobRpcErr?.message);

    // No UPDATE policy exists on mcq_sets, so a direct PATCH must fail even for
    // the owner — this is what stops a browser rewriting correct_index.
    const { data: patched, error: patchErr } = await alice.db
      .from('mcq_sets')
      .update({ answers: [{ selected_index: 0, correct: true }] })
      .eq('id', setId)
      .select();
    check(
      'direct PATCH of answers is rejected (no UPDATE policy)',
      Boolean(patchErr) || (patched?.length ?? 0) === 0,
      patchErr?.code ?? `updated ${patched?.length} row(s)`,
    );

    const { error: aliceVaultErr } = await alice.db.rpc('get_gemini_key_for', { p_user: bob.id });
    check(
      'authenticated cannot execute get_gemini_key_for',
      Boolean(aliceVaultErr),
      aliceVaultErr?.code,
    );

    console.log('\n=== Vault: store, rotate, delete ===');
    const KEY_A = 'AIza-test-key-alice-1234567890';
    const { error: setErr } = await alice.db.rpc('set_gemini_key', { p_key: KEY_A });
    check('A can store a key', !setErr, setErr?.message);

    const { data: keyId1 } = await admin
      .from('user_settings')
      .select('gemini_key_id')
      .eq('user_id', alice.id)
      .single();
    const firstId = (keyId1 as { gemini_key_id: string | null }).gemini_key_id;
    check('user_settings holds a vault id, not the key', Boolean(firstId) && firstId !== KEY_A);

    const { data: plaintext } = await admin.rpc('get_gemini_key_for', { p_user: alice.id });
    check('service_role can read the plaintext back', plaintext === KEY_A);

    const { data: bobRead } = await admin.rpc('get_gemini_key_for', { p_user: bob.id });
    check('a user without a key returns null', bobRead === null);

    // Rotation must delete the old secret, not orphan it.
    const KEY_B = 'AIza-test-key-alice-rotated-999';
    await alice.db.rpc('set_gemini_key', { p_key: KEY_B });
    const { data: keyId2 } = await admin
      .from('user_settings')
      .select('gemini_key_id')
      .eq('user_id', alice.id)
      .single();
    const secondId = (keyId2 as { gemini_key_id: string | null }).gemini_key_id;
    check('rotation repoints to a new secret', Boolean(secondId) && secondId !== firstId);

    const { data: rotated } = await admin.rpc('get_gemini_key_for', { p_user: alice.id });
    check('rotated key reads back as the new value', rotated === KEY_B);

    const orphans = await vaultSecretCount(firstId!);
    if (orphans === null) console.log('  SKIP  rotation orphan check — apply 0004_audit_vault.sql');
    else
      check('the OLD vault secret is gone after rotation', orphans === 0, `${orphans} row(s) remain`);

    // Delete must drop the secret, not merely unlink it.
    await alice.db.rpc('clear_gemini_key');
    const afterClear = await vaultSecretCount(secondId!);
    if (afterClear === null) console.log('  SKIP  delete orphan check — apply 0004_audit_vault.sql');
    else
      check(
        'delete drops the vault secret, not just the column',
        afterClear === 0,
        `${afterClear} row(s) remain`,
      );
    const { data: cleared } = await admin.rpc('get_gemini_key_for', { p_user: alice.id });
    check('reading after delete returns null', cleared === null);

    console.log('\n=== batch-trim determinism (identical created_at) ===');
    const stamp = new Date().toISOString();
    const rows = Array.from({ length: 6 }, (_, i) => ({
      content_item_id: itemId,
      user_id: bob.id,
      model: `batch-${i}`,
      language: 'python3',
      questions: QUESTIONS,
      created_at: stamp, // every row shares a timestamp, the P3 migration case
    }));
    const { error: batchErr } = await bob.db.from('mcq_sets').insert(rows);
    check('batch insert of 6 succeeds', !batchErr, batchErr?.message);

    const { data: kept } = await admin
      .from('mcq_sets')
      .select('model')
      .eq('user_id', bob.id)
      .eq('content_item_id', itemId);
    check('exactly 5 survive the trim trigger', (kept?.length ?? 0) === 5, `${kept?.length} kept`);

    console.log('\n=== account deletion cascades the vault secret ===');
    await bob.db.rpc('set_gemini_key', { p_key: 'AIza-test-key-bob-0987654321' });
    const { data: bobKeyRow } = await admin
      .from('user_settings')
      .select('gemini_key_id')
      .eq('user_id', bob.id)
      .single();
    const bobSecret = (bobKeyRow as { gemini_key_id: string | null }).gemini_key_id;
    check('B has a stored key before deletion', Boolean(bobSecret));

    await admin.auth.admin.deleteUser(bob.id);
    const bobOrphan = await vaultSecretCount(bobSecret!);
    if (bobOrphan === null)
      console.log('  SKIP  account-deletion orphan check — apply 0004_audit_vault.sql');
    else
      check(
        'deleting the account drops the vault secret',
        bobOrphan === 0,
        `${bobOrphan} decryptable orphan(s) remain`,
      );
  } finally {
    await admin.auth.admin.deleteUser(alice.id).catch(() => {});
    await admin.auth.admin.deleteUser(bob.id).catch(() => {});
    console.log('\ncleaned up test users');
  }

  console.log('');
  if (failures > 0) {
    console.log(`FAILED — ${failures} check(s)`);
    process.exit(1);
  }
  console.log('ALL CHECKS PASSED');
}

await main();
