/**
 * Inspect seeded rows. Read-only. Run after `npm run seed -- --limit 20`.
 *
 *   npx tsx scripts/verify-seed.ts
 *
 * Checks the things that fail SILENTLY:
 *   - metadata.topic_text agrees with content_item_tags (drift = dead search)
 *   - required captures (hints, exampleTestcases, codeSnippets) are present
 *   - body_html was sanitized (no <script>)
 *   - search_vector actually populated from topic_text
 *   - sort_key is set, so the feed opens at Two Sum
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config as loadEnv } from 'dotenv';

loadEnv({ path: '.env.local', quiet: true });

function adminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('missing Supabase env vars');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

type Row = {
  id: string;
  slug: string;
  title: string;
  difficulty: string | null;
  sort_key: number | null;
  body_html: string | null;
  content_hash: string | null;
  metadata: Record<string, unknown>;
};

function fail(msg: string): void {
  console.log(`  FAIL  ${msg}`);
  process.exitCode = 1;
}

async function main(): Promise<void> {
  const db = adminClient();

  const { count } = await db.from('content_items').select('*', { count: 'exact', head: true });
  console.log(`content_items rows: ${count}\n`);

  const { data, error } = await db
    .from('content_items')
    .select('id, slug, title, difficulty, sort_key, body_html, content_hash, metadata')
    .order('sort_key', { ascending: true })
    .limit(50);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Row[];

  console.log('--- first 5 rows by sort_key ---');
  for (const r of rows.slice(0, 5)) {
    const md = r.metadata;
    console.log(
      `  ${String(r.sort_key).padStart(4)} ${r.slug.padEnd(46)} ${String(r.difficulty).padEnd(7)}` +
        ` body=${r.body_html ? `${r.body_html.length}ch` : 'NULL'}` +
        ` hints=${Array.isArray(md.hints) ? md.hints.length : 'NULL'}` +
        ` snips=${Array.isArray(md.codeSnippets) ? md.codeSnippets.length : 'NULL'}`,
    );
  }

  console.log('\n--- required captures present on every row ---');
  let capturesOk = true;
  for (const r of rows) {
    const md = r.metadata;
    const problems: string[] = [];
    if (md.isPaidOnly !== true) {
      if (!r.body_html) problems.push('body_html null');
      if (!r.content_hash) problems.push('content_hash null');
      if (!Array.isArray(md.hints)) problems.push('hints missing');
      if (typeof md.exampleTestcases !== 'string') problems.push('exampleTestcases missing');
      if (!Array.isArray(md.codeSnippets) || md.codeSnippets.length === 0)
        problems.push('codeSnippets missing');
      if (typeof md.list_hash !== 'string') problems.push('list_hash missing');
      if (r.sort_key === null) problems.push('sort_key null');
    }
    if (problems.length > 0) {
      capturesOk = false;
      fail(`${r.slug}: ${problems.join(', ')}`);
    }
  }
  if (capturesOk) console.log(`  PASS  all ${rows.length} rows carry the required captures`);

  // This sweeps EVERY row, not the 50-row sample above. A sample missed a real
  // bug once: the paid-only branch wrote metadata.topic_text but returned
  // before the join write, leaving 734 rows drifted. All 734 were paid-only, so
  // a sample of the first 50 (all free) reported PASS.
  console.log('\n--- topic_text vs content_item_tags (ALL rows) ---');
  const allRows: Array<{ id: string; slug: string; metadata: Record<string, unknown> }> = [];
  for (let from = 0; ; from += 1000) {
    const { data: page, error: pErr } = await db
      .from('content_items')
      .select('id, slug, metadata')
      .order('sort_key', { ascending: true })
      .range(from, from + 999);
    if (pErr) throw new Error(pErr.message);
    if (!page || page.length === 0) break;
    allRows.push(...(page as Array<{ id: string; slug: string; metadata: Record<string, unknown> }>));
    if (page.length < 1000) break;
  }

  let mismatches = 0;
  for (let i = 0; i < allRows.length; i += 200) {
    const batch = allRows.slice(i, i + 200);
    const { data: joins, error: jErr } = await db
      .from('content_item_tags')
      .select('content_item_id, tags(slug)')
      .in('content_item_id', batch.map((b) => b.id));
    if (jErr) throw new Error(jErr.message);

    // PostgREST types the embedded relation as an array here; normalize both
    // shapes rather than fighting the generated type.
    const byItem = new Map<string, string[]>();
    for (const j of (joins ?? []) as unknown as Array<{
      content_item_id: string;
      tags: { slug: string } | Array<{ slug: string }> | null;
    }>) {
      const slugs = Array.isArray(j.tags) ? j.tags.map((t) => t.slug) : j.tags ? [j.tags.slug] : [];
      byItem.set(j.content_item_id, [...(byItem.get(j.content_item_id) ?? []), ...slugs]);
    }

    for (const r of batch) {
      const topicText = typeof r.metadata.topic_text === 'string' ? r.metadata.topic_text : '';
      const fromText = topicText.split(' ').filter(Boolean).sort();
      const fromJoin = (byItem.get(r.id) ?? []).sort();
      if (JSON.stringify(fromText) !== JSON.stringify(fromJoin)) {
        if (mismatches < 5) {
          fail(`${r.slug}: topic_text [${fromText.join(' ')}] != join rows [${fromJoin.join(' ')}]`);
        }
        mismatches++;
      }
    }
  }
  if (mismatches === 0) {
    console.log(`  PASS  topic_text matches content_item_tags on all ${allRows.length} rows`);
  } else {
    fail(`${mismatches} row(s) drifted in total`);
  }

  console.log('\n--- sanitization ---');
  const withScript = rows.filter((r) => /<script|onerror=|javascript:/i.test(r.body_html ?? ''));
  if (withScript.length > 0) fail(`${withScript.length} rows contain script/handler markup`);
  else console.log(`  PASS  no <script>, onerror=, or javascript: in any body_html`);

  console.log('\n--- search_vector populated from topic_text ---');
  const probe = rows.find((r) => (r.metadata.topic_text as string | undefined)?.includes('hash-table'));
  if (!probe) {
    console.log('  SKIP  no row tagged hash-table in this sample');
  } else {
    const { data: hits, error: sErr } = await db
      .from('content_items')
      .select('slug')
      .textSearch('search_vector', 'hash & table')
      .limit(5);
    if (sErr) throw new Error(sErr.message);
    const found = (hits ?? []) as Array<{ slug: string }>;
    if (found.length === 0) fail("textSearch('hash & table') returned nothing — topic_text is not feeding search_vector");
    else console.log(`  PASS  textSearch matched ${found.length}: ${found.map((h) => h.slug).join(', ')}`);
  }

  console.log('\n--- sync_runs ---');
  const { data: runs, error: rErr } = await db
    .from('sync_runs')
    .select('id, status, cursor, processed, failed, error')
    .order('started_at', { ascending: false })
    .limit(5);
  if (rErr) throw new Error(rErr.message);
  for (const run of (runs ?? []) as Array<Record<string, unknown>>) {
    console.log(
      `  ${String(run.status).padEnd(10)} cursor=${run.cursor} processed=${run.processed}` +
        ` failed=${run.failed}${run.error ? ` error=${String(run.error).slice(0, 80)}` : ''}`,
    );
  }

  console.log('\n--- tags ---');
  const { count: tagCount } = await db.from('tags').select('*', { count: 'exact', head: true });
  const { count: joinCount } = await db
    .from('content_item_tags')
    .select('*', { count: 'exact', head: true });
  console.log(`  tags=${tagCount} content_item_tags=${joinCount}`);
}

main().catch((err: unknown) => {
  console.error('verify crashed:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
