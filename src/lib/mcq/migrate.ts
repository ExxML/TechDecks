import type { SupabaseClient } from '@supabase/supabase-js';
import { MAX_SETS_PER_ITEM, STORAGE_PREFIX, type McqSet } from './store';

/**
 * One-time migration of anonymous localStorage sets into the database on first
 * sign-in.
 *
 * "A single insert" understates it: 30 problems x 5 sets is up to 150 rows.
 * Four rules, all of them required:
 *
 *  1. PRESERVE TIMESTAMPS. Each entry's generated_at is written into
 *     created_at. Without it every migrated row shares now(), and the trim
 *     trigger's ordering becomes arbitrary.
 *  2. INSERT OLDEST-FIRST, GROUPED BY content_item_id, so the trigger
 *     deterministically keeps the newest five.
 *  3. COLLISION RULE. When a problem has sets in both places, union them, sort
 *     by generated_at desc, keep five.
 *  4. IDEMPOTENCY. The migrated flag is set only AFTER the inserts commit, and
 *     the per-problem keys are cleared in the same step, so a partial migration
 *     that re-runs cannot duplicate rows.
 */

export const MIGRATED_FLAG = 'techdecks:migrated';

export type MigrationResult = {
  readonly migratedSets: number;
  readonly problems: number;
  readonly skipped: boolean;
};

type LocalEntry = { readonly contentItemId: string; readonly sets: McqSet[] };

/** Every problem that has locally stored sets. */
function readAllLocal(): LocalEntry[] {
  if (typeof window === 'undefined') return [];
  const out: LocalEntry[] = [];
  for (let i = 0; i < window.localStorage.length; i++) {
    const key = window.localStorage.key(i);
    if (!key?.startsWith(STORAGE_PREFIX)) continue;
    const contentItemId = key.slice(STORAGE_PREFIX.length);
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) continue;
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) continue;
      const sets = parsed.filter(
        (s): s is McqSet =>
          typeof s === 'object' &&
          s !== null &&
          typeof (s as McqSet).generated_at === 'string' &&
          Array.isArray((s as McqSet).questions),
      );
      if (sets.length > 0) out.push({ contentItemId, sets });
    } catch {
      // Unreadable entry: skip it rather than aborting the whole migration.
    }
  }
  return out;
}

export async function migrateLocalSets(
  db: SupabaseClient,
  userId: string,
): Promise<MigrationResult> {
  if (typeof window === 'undefined') {
    return { migratedSets: 0, problems: 0, skipped: true };
  }

  // Rule 4: already migrated on this browser.
  if (window.localStorage.getItem(MIGRATED_FLAG) === '1') {
    return { migratedSets: 0, problems: 0, skipped: true };
  }

  const local = readAllLocal();
  if (local.length === 0) {
    window.localStorage.setItem(MIGRATED_FLAG, '1');
    return { migratedSets: 0, problems: 0, skipped: false };
  }

  let migratedSets = 0;
  let problems = 0;

  for (const { contentItemId, sets } of local) {
    // Rule 3: union local with whatever already exists for this problem.
    const { data: existing, error: readErr } = await db
      .from('mcq_sets')
      .select('created_at')
      .eq('content_item_id', contentItemId)
      .eq('user_id', userId);
    if (readErr) throw new Error(`migration read failed: ${readErr.message}`);

    const existingTimes = ((existing ?? []) as Array<{ created_at: string }>).map((r) =>
      Date.parse(r.created_at),
    );

    // Newest five across BOTH sources decides what is worth inserting; a local
    // set older than five existing DB sets would be trimmed away immediately.
    const candidates = [...sets].sort(
      (a, b) => Date.parse(b.generated_at) - Date.parse(a.generated_at),
    );
    const keep = candidates
      .filter((s) => {
        const t = Date.parse(s.generated_at);
        const newerExisting = existingTimes.filter((e) => e > t).length;
        return newerExisting < MAX_SETS_PER_ITEM;
      })
      .slice(0, MAX_SETS_PER_ITEM);

    if (keep.length === 0) {
      window.localStorage.removeItem(`${STORAGE_PREFIX}${contentItemId}`);
      continue;
    }

    // Rule 2: oldest-first, so the trigger keeps the newest five.
    const ordered = [...keep].sort(
      (a, b) => Date.parse(a.generated_at) - Date.parse(b.generated_at),
    );

    const rows = ordered.map((s) => ({
      content_item_id: contentItemId,
      user_id: userId,
      model: s.model,
      language: s.language,
      prompt_version: s.prompt_version,
      questions: s.questions,
      // Answer state carries across unchanged — the local shape is the DB shape.
      answers: s.answers,
      answered_at: s.answered_at,
      // Rule 1. Without this the original generation times are gone forever.
      created_at: s.generated_at,
    }));

    // Inserted one at a time, not as a batch: a multi-row insert shares one
    // transaction timestamp, and the after-insert trim trigger fires per row.
    // Sequential inserts keep the ordering the trigger sees unambiguous.
    for (const row of rows) {
      const { error } = await db.from('mcq_sets').insert(row);
      if (error) throw new Error(`migration insert failed: ${error.message}`);
      migratedSets++;
    }

    problems++;
    // Rule 4: clear this problem's key only after its rows have committed.
    window.localStorage.removeItem(`${STORAGE_PREFIX}${contentItemId}`);
  }

  window.localStorage.setItem(MIGRATED_FLAG, '1');
  return { migratedSets, problems, skipped: false };
}
