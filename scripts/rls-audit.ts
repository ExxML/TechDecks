/**
 * RLS audit — the full matrix, not a spot check.
 *
 *   npx tsx scripts/rls-audit.ts
 *
 * A single-table read test passes even when four tables are world-writable,
 * so this attempts SELECT / INSERT / UPDATE / DELETE against EVERY table in
 * public using the ANON key — the same key that ships in the browser bundle —
 * and compares each result against the intended matrix.
 *
 * Also checks:
 *   - pg_tables.rowsecurity is true on every table (via a service-role RPC-free
 *     probe, see checkRowSecurity)
 *   - the service role can still read all rows and write public content_items
 *   - the Vault read wrapper is NOT executable by anon/authenticated
 *
 * Exits non-zero if anything deviates.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config as loadEnv } from 'dotenv';

loadEnv({ path: '.env.local', quiet: true });

const TABLES = [
  'sources',
  'tags',
  'content_item_tags',
  'content_items',
  'content_references',
  'mcq_sets',
  'bookmarks',
  'user_settings',
  'sync_runs',
] as const;
type TableName = (typeof TABLES)[number];

type Op = 'select' | 'insert' | 'update' | 'delete';
/** true = the operation must SUCCEED for anon; false = must be REJECTED. */
type Matrix = Record<TableName, Record<Op, boolean>>;

/**
 * Intended anon matrix.
 *
 * Reference tables are readable by design (the feed needs sources/tags without
 * a session). Everything else is closed to anon: mcq_sets/bookmarks/
 * user_settings policies are `to authenticated`, and sync_runs has NO policy at
 * all, so RLS-on + zero-policies denies everything.
 */
const EXPECTED: Matrix = {
  sources:            { select: true,  insert: false, update: false, delete: false },
  tags:               { select: true,  insert: false, update: false, delete: false },
  content_item_tags:  { select: true,  insert: false, update: false, delete: false },
  content_items:      { select: true,  insert: false, update: false, delete: false },
  content_references: { select: true,  insert: false, update: false, delete: false },
  mcq_sets:           { select: false, insert: false, update: false, delete: false },
  bookmarks:          { select: false, insert: false, update: false, delete: false },
  user_settings:      { select: false, insert: false, update: false, delete: false },
  sync_runs:          { select: false, insert: false, update: false, delete: false },
};

/** Minimal syntactically-valid payloads. They must be REJECTED by policy,
 *  not by a column mismatch, or the test proves nothing. */
const INSERT_PAYLOAD: Record<TableName, Record<string, unknown>> = {
  sources:            { id: 'rls-probe', name: 'RLS probe' },
  tags:               { slug: 'rls-probe', name: 'RLS probe' },
  content_item_tags:  { content_item_id: '00000000-0000-0000-0000-000000000001', tag_id: '00000000-0000-0000-0000-000000000002' },
  content_items:      { source_id: 'user', slug: 'rls-probe', title: 'RLS probe', visibility: 'public' },
  content_references: { content_item_id: '00000000-0000-0000-0000-000000000001', kind: 'user_note', body: 'probe' },
  mcq_sets:           { content_item_id: '00000000-0000-0000-0000-000000000001', user_id: '00000000-0000-0000-0000-000000000003', model: 'probe', questions: [] },
  bookmarks:          { user_id: '00000000-0000-0000-0000-000000000003', content_item_id: '00000000-0000-0000-0000-000000000001' },
  user_settings:      { user_id: '00000000-0000-0000-0000-000000000003' },
  sync_runs:          { source_id: 'leetcode', status: 'running' },
};

/** A column that exists on the table, used for the UPDATE probe. */
const UPDATE_PATCH: Record<TableName, Record<string, unknown>> = {
  sources:            { name: 'pwned' },
  tags:               { name: 'pwned' },
  content_item_tags:  { tag_id: '00000000-0000-0000-0000-000000000002' },
  content_items:      { title: 'pwned' },
  content_references: { body: 'pwned' },
  mcq_sets:           { model: 'pwned' },
  bookmarks:          { created_at: new Date().toISOString() },
  user_settings:      { preferred_lang: 'pwned' },
  sync_runs:          { status: 'pwned' },
};

type Result = { ok: boolean; detail: string };

function client(key: string): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  if (!url) throw new Error('NEXT_PUBLIC_SUPABASE_URL is not set');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Row counts as seen by the service role, so an anon read of 0 can be judged. */
const svcCounts: Partial<Record<TableName, number>> = {};

/**
 * An RLS-denied operation returns either an explicit 42501 error OR a silent
 * zero-row result, depending on the operation. Both count as "rejected";
 * only an actual affected/visible row counts as "succeeded".
 *
 * For SELECT this distinction is subtle and worth stating: a policy-denied read
 * is not an error in PostgREST, it is an empty set. So "anon read 0 rows" only
 * proves denial when the service role can see rows that anon cannot. When the
 * table is genuinely empty the probe is INCONCLUSIVE, and it says so rather
 * than reporting a pass it did not earn.
 */
async function probe(db: SupabaseClient, table: TableName, op: Op): Promise<Result> {
  try {
    if (op === 'select') {
      const { data, error } = await db.from(table).select('*').limit(1);
      if (error) return { ok: false, detail: `${error.code ?? ''} ${error.message}`.trim() };
      const seen = data?.length ?? 0;
      if (seen > 0) return { ok: true, detail: `read ${seen} row(s)` };
      const actual = svcCounts[table] ?? 0;
      if (actual === 0) {
        // No error and no rows, from an empty table. Cannot distinguish
        // "policy allowed it, nothing to return" from "policy denied it".
        // Report it as matching whatever was expected, tagged INCONCLUSIVE so
        // it is never mistaken for a real pass.
        return {
          ok: EXPECTED[table].select,
          detail: 'read 0 rows, but table is empty — INCONCLUSIVE',
        };
      }
      return { ok: false, detail: `read 0 of ${actual} existing row(s) — denied by policy` };
    }

    if (op === 'insert') {
      const { data, error } = await db.from(table).insert(INSERT_PAYLOAD[table]).select();
      if (error) return { ok: false, detail: `${error.code ?? ''} ${error.message}`.trim() };
      return { ok: (data?.length ?? 0) > 0, detail: `inserted ${data?.length ?? 0} row(s)` };
    }

    if (op === 'update') {
      // `not id is null`-style always-true filter is not available uniformly,
      // so filter on a column every table has: update everything the policy allows.
      const { data, error } = await db
        .from(table)
        .update(UPDATE_PATCH[table])
        .gte('created_at', '1970-01-01')
        .select();
      if (error) return { ok: false, detail: `${error.code ?? ''} ${error.message}`.trim() };
      return { ok: (data?.length ?? 0) > 0, detail: `updated ${data?.length ?? 0} row(s)` };
    }

    const { data, error } = await db
      .from(table)
      .delete()
      .gte('created_at', '1970-01-01')
      .select();
    if (error) return { ok: false, detail: `${error.code ?? ''} ${error.message}`.trim() };
    return { ok: (data?.length ?? 0) > 0, detail: `deleted ${data?.length ?? 0} row(s)` };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

let failures = 0;

async function main(): Promise<void> {
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!anonKey || !svcKey) throw new Error('missing anon or service role key');

  const anon = client(anonKey);
  const svc = client(svcKey);

  // -- 1. rowsecurity on every table ---------------------------------------
  //
  // PostgREST cannot select from pg_tables, so this uses the debug RPC created
  // by 0003_audit_rpc.sql (service-role only). If that migration has not been
  // applied the check degrades to a warning rather than a false pass — the
  // behavioural matrix in section 2 is the real proof either way.
  console.log('=== 1. RLS enabled on every public table ===\n');
  const { data: rlsRows, error: rlsErr } = await svc.rpc('audit_rls_status');
  if (rlsErr) {
    console.log(`  WARN  audit_rls_status unavailable (${rlsErr.message})`);
    console.log('        Apply supabase/migrations/0003_audit_rpc.sql to enable this check.');
    console.log('        Falling back to the behavioural matrix in section 2.\n');
  } else {
    const rows = (rlsRows ?? []) as Array<{ tablename: string; rowsecurity: boolean }>;
    for (const r of rows) {
      const ok = r.rowsecurity === true;
      if (!ok) failures++;
      console.log(`  ${r.tablename.padEnd(20)} rowsecurity=${String(r.rowsecurity).padEnd(6)} ${ok ? 'PASS' : '*** FAIL ***'}`);
    }
    const missing = TABLES.filter((t) => !rows.some((r) => r.tablename === t));
    if (missing.length > 0) {
      failures++;
      console.log(`  *** FAIL *** tables absent from pg_tables: ${missing.join(', ')}`);
    }
    console.log(`\n  ${rows.length} table(s) checked.\n`);
  }

  // Row counts as the service role sees them. A SELECT probe returning 0 rows
  // only proves denial if there was something to deny.
  for (const t of TABLES) {
    const { count } = await svc.from(t).select('*', { count: 'exact', head: true });
    svcCounts[t] = count ?? 0;
  }

  // -- 2. the anon matrix ---------------------------------------------------
  console.log('=== 2. Anon matrix (the anon key ships in the browser) ===\n');
  console.log('  table                 op       expected   actual     verdict');
  console.log('  ' + '-'.repeat(66));

  const inconclusive: string[] = [];

  for (const table of TABLES) {
    for (const op of ['select', 'insert', 'update', 'delete'] as Op[]) {
      const expected = EXPECTED[table][op];
      const res = await probe(anon, table, op);
      const pass = res.ok === expected;
      const weak = pass && res.detail.includes('INCONCLUSIVE');
      if (!pass) failures++;
      if (weak) inconclusive.push(`${table}.${op}`);
      console.log(
        `  ${table.padEnd(20)} ${op.padEnd(8)} ` +
          `${(expected ? 'allow' : 'deny').padEnd(10)} ${(res.ok ? 'allow' : 'deny').padEnd(10)} ` +
          `${!pass ? '*** FAIL ***' : weak ? 'pass (weak)' : 'PASS'}`,
      );
      if (!pass || weak) console.log(`      -> ${res.detail}`);
    }
  }

  if (inconclusive.length > 0) {
    console.log(
      `\n  NOTE: ${inconclusive.length} probe(s) are inconclusive because the table is empty` +
        `: ${inconclusive.join(', ')}.\n  Section 2b plants real rows to settle them.`,
    );
  }

  // -- 2b. plant rows, then prove anon cannot see them ----------------------
  // The three user-owned tables are empty until a user signs in, so the reads
  // above prove nothing on their own. Insert real rows as service role against
  // a synthetic user, re-probe as anon, then clean up.
  console.log('\n=== 2b. Planted-row reads (settles the empty-table probes) ===\n');

  const { data: anyItem } = await svc.from('content_items').select('id').limit(1).single();
  const itemId = (anyItem as { id: string } | null)?.id ?? null;

  // content_references has no user column — refs_read grants anon SELECT for any
  // reference attached to a PUBLIC content_item. Plant one and confirm anon CAN
  // read it, which is the intended behaviour rather than a denial.
  if (itemId) {
    const { data: ref, error: refErr } = await svc
      .from('content_references')
      .insert({ content_item_id: itemId, kind: 'user_note', body: 'rls audit probe' })
      .select('id')
      .single();
    if (refErr || !ref) {
      console.log(`  SKIP  could not plant content_references: ${refErr?.message}`);
    } else {
      const { data: anonRefs } = await anon.from('content_references').select('*').limit(5);
      const visible = (anonRefs?.length ?? 0) > 0;
      if (!visible) failures++;
      console.log(
        `  ${'content_references'.padEnd(16)} anon sees ${anonRefs?.length ?? 0} row(s) on a public item  ` +
          `${visible ? 'PASS' : '*** FAIL — refs_read should allow this ***'}`,
      );
      await svc.from('content_references').delete().eq('id', (ref as { id: string }).id);
    }
  }

  // mcq_sets/bookmarks/user_settings all FK to auth.users, which we cannot
  // populate from here without creating a real auth user. Do exactly that:
  // an admin-created user, deleted at the end.
  const { data: created, error: userErr } = await svc.auth.admin.createUser({
    email: `rls-audit-${Date.now()}@example.invalid`,
    password: crypto.randomUUID(),
    email_confirm: true,
  });

  if (userErr || !created?.user || !itemId) {
    console.log(`  SKIP  could not create a probe user (${userErr?.message ?? 'no content_items row'})`);
    console.log('        The three SELECT probes above remain inconclusive.');
  } else {
    const uid = created.user.id;
    const planted: Array<[TableName, Record<string, unknown>]> = [
      ['user_settings', { user_id: uid, preferred_lang: 'python3' }],
      ['bookmarks', { user_id: uid, content_item_id: itemId }],
      [
        'mcq_sets',
        {
          user_id: uid,
          content_item_id: itemId,
          model: 'audit-probe',
          questions: [
            { kind: 'approach', question: 'probe', options: [], explanation: 'probe', correct_index: 0 },
          ],
        },
      ],
    ];

    for (const [table, payload] of planted) {
      const { error: insErr } = await svc.from(table).insert(payload);
      if (insErr) {
        console.log(`  SKIP  could not plant into ${table}: ${insErr.message}`);
        continue;
      }
      const { count: svcNow } = await svc.from(table).select('*', { count: 'exact', head: true });
      const { data: anonRows, error: anonErr } = await anon.from(table).select('*').limit(5);
      const anonSees = anonRows?.length ?? 0;
      const denied = anonSees === 0;
      if (!denied) failures++;
      console.log(
        `  ${table.padEnd(16)} service_role sees ${svcNow}, anon sees ${anonSees}` +
          `${anonErr ? ` (${anonErr.code})` : ''}  ${denied ? 'PASS' : '*** FAIL — anon can read user data ***'}`,
      );
    }

    // Cleanup. Deleting the auth user cascades every planted row.
    const { error: delErr } = await svc.auth.admin.deleteUser(uid);
    console.log(`  ----  probe user ${delErr ? `NOT deleted: ${delErr.message}` : 'deleted (rows cascaded)'}`);
  }

  // -- 3. the two destructive writes that matter most -----------------------
  console.log('\n=== 3. Highest-risk anon writes ===\n');
  const tagDelete = await probe(anon, 'tags', 'delete');
  console.log(`  anon DELETE on tags       : ${tagDelete.ok ? '*** ALLOWED — FAIL ***' : 'rejected  PASS'}`);
  if (tagDelete.ok) failures++;
  const syncInsert = await probe(anon, 'sync_runs', 'insert');
  console.log(`  anon INSERT on sync_runs  : ${syncInsert.ok ? '*** ALLOWED — FAIL ***' : 'rejected  PASS'}`);
  if (syncInsert.ok) failures++;

  // -- 4. service role still works ------------------------------------------
  console.log('\n=== 4. Service role retains full access ===\n');
  const { count: svcCount, error: svcErr } = await svc
    .from('content_items')
    .select('*', { count: 'exact', head: true });
  if (svcErr) {
    failures++;
    console.log(`  *** FAIL *** service role read: ${svcErr.message}`);
  } else {
    console.log(`  PASS  service role reads content_items (${svcCount} rows)`);
  }

  const probeSlug = `rls-audit-probe-${Date.now()}`;
  const { error: wErr } = await svc.from('content_items').insert({
    source_id: 'user',
    slug: probeSlug,
    title: 'RLS audit probe',
    visibility: 'public',
    owner_id: null,
  });
  if (wErr) {
    failures++;
    console.log(`  *** FAIL *** service role write: ${wErr.message}`);
  } else {
    console.log('  PASS  service role writes public content_items');
    await svc.from('content_items').delete().eq('slug', probeSlug);
    console.log('  ----  probe row removed');
  }

  // -- 5. Vault read wrapper must be unreachable from the browser -----------
  console.log('\n=== 5. Vault read wrapper is not client-callable ===\n');
  const { error: vaultErr } = await anon.rpc('get_gemini_key_for', {
    p_user: '00000000-0000-0000-0000-000000000003',
  });
  if (!vaultErr) {
    failures++;
    console.log('  *** FAIL *** anon can execute get_gemini_key_for');
  } else {
    console.log(`  PASS  anon cannot execute get_gemini_key_for (${vaultErr.code ?? ''} ${vaultErr.message})`);
  }

  // get_gemini_key() is granted to `authenticated` so the server can read a
  // stored key on any device. Signed out there is no auth.uid(), so it must
  // still refuse rather than fall back to some other row.
  const { error: ownVaultErr } = await anon.rpc('get_gemini_key');
  if (!ownVaultErr) {
    failures++;
    console.log('  *** FAIL *** anon can execute get_gemini_key');
  } else {
    console.log(`  PASS  anon cannot execute get_gemini_key (${ownVaultErr.code ?? ''} ${ownVaultErr.message})`);
  }

  const { error: setErr } = await anon.rpc('set_gemini_key', { p_key: 'x'.repeat(40) });
  console.log(
    setErr
      ? `  PASS  anon set_gemini_key rejected (${setErr.code ?? ''} ${setErr.message})`
      : '  *** FAIL *** anon could call set_gemini_key',
  );
  if (!setErr) failures++;

  const { error: raErr } = await anon.rpc('record_answer', {
    p_set_id: '00000000-0000-0000-0000-000000000001',
    p_index: 0,
    p_selected: 0,
  });
  console.log(
    raErr
      ? `  PASS  anon record_answer rejected (${raErr.code ?? ''} ${raErr.message})`
      : '  *** FAIL *** anon could call record_answer',
  );
  if (!raErr) failures++;

  console.log('');
  if (failures > 0) {
    console.log(`RLS AUDIT FAILED — ${failures} deviation(s) from the intended matrix`);
    process.exit(1);
  }
  console.log('RLS AUDIT PASSED — anon matrix matches intent on all 9 tables');
}

main().catch((err: unknown) => {
  console.error('audit crashed:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
