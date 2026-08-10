/**
 * Apply a migration file through the Supabase Management API.
 *
 *   npx tsx scripts/apply-migration.ts supabase/migrations/0003_audit_rpc.sql
 *
 * The SQL editor is the normal way to apply a migration by hand. This exists
 * so a migration can be applied non-interactively, which is what makes the
 * idempotency check — apply twice, confirm the second run is clean — runnable.
 *
 * Requires SUPABASE_ACCESS_TOKEN (a personal access token from
 * https://supabase.com/dashboard/account/tokens) and SUPABASE_PROJECT_REF.
 * Both are optional developer conveniences and are NOT part of the app's
 * runtime environment — the deployed app never talks to the Management API.
 */

import { readFileSync } from 'node:fs';
import { config as loadEnv } from 'dotenv';

loadEnv({ path: '.env.local', quiet: true });

function projectRef(): string {
  const explicit = process.env.SUPABASE_PROJECT_REF;
  if (explicit) return explicit;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const m = /^https:\/\/([a-z0-9]+)\.supabase\.co/i.exec(url);
  if (!m) throw new Error('cannot derive project ref; set SUPABASE_PROJECT_REF');
  return m[1];
}

async function main(): Promise<void> {
  const file = process.argv[2];
  if (!file) throw new Error('usage: apply-migration.ts <path-to-sql>');

  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) {
    throw new Error(
      'SUPABASE_ACCESS_TOKEN is not set. Create one at ' +
        'https://supabase.com/dashboard/account/tokens and add it to .env.local, ' +
        'or paste the file into the Supabase SQL editor instead.',
    );
  }

  const sql = readFileSync(file, 'utf8');
  const ref = projectRef();
  console.log(`applying ${file} to project ${ref} (${sql.length} bytes)`);

  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: sql }),
  });

  const body = await res.text();
  if (!res.ok) {
    console.error(`FAILED ${res.status}: ${body.slice(0, 2000)}`);
    process.exit(1);
  }
  console.log(`OK ${res.status}`);
  if (body && body !== '[]') console.log(body.slice(0, 2000));
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
