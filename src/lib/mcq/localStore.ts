import {
  MAX_SETS_PER_ITEM,
  STORAGE_PREFIX,
  type McqSet,
  type McqStore,
  type NewMcqSet,
} from './store';

/**
 * localStorage-backed McqStore for anonymous users. Most-recent-5 per problem
 * under `techdeck:mcq:{contentItemId}`, in the same JSON shape as the mcq_sets
 * column.
 *
 * Correctness is computed here rather than in SQL, which is safe only because
 * the whole set — correct_index included — already sits in the user's own
 * browser. The signed-in store defers to record_answer() instead.
 */

function keyFor(contentItemId: string): string {
  return `${STORAGE_PREFIX}${contentItemId}`;
}

/** Storage can throw: private mode, quota, disabled cookies. Never crash the app. */
function readSets(contentItemId: string): McqSet[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(keyFor(contentItemId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Trust but verify: a hand-edited or older-shape entry must not crash the
    // renderer. Anything missing the load-bearing fields is dropped.
    return parsed.filter((s): s is McqSet => {
      if (typeof s !== 'object' || s === null) return false;
      const c = s as Partial<McqSet>;
      return (
        typeof c.id === 'string' &&
        typeof c.content_item_id === 'string' &&
        typeof c.generated_at === 'string' &&
        Array.isArray(c.questions) &&
        Array.isArray(c.answers)
      );
    });
  } catch {
    return [];
  }
}

function writeSets(contentItemId: string, sets: readonly McqSet[]): void {
  if (typeof window === 'undefined') return;
  try {
    if (sets.length === 0) {
      window.localStorage.removeItem(keyFor(contentItemId));
      return;
    }
    window.localStorage.setItem(keyFor(contentItemId), JSON.stringify(sets));
  } catch {
    // Quota exceeded or storage unavailable. The in-memory set still renders
    // for this session; it just will not survive a reload.
  }
}

/** Newest first, mirroring the DB's `created_at desc, id desc`. */
function sortNewestFirst(sets: readonly McqSet[]): McqSet[] {
  return [...sets].sort((a, b) => {
    const t = Date.parse(b.generated_at) - Date.parse(a.generated_at);
    return t !== 0 ? t : b.id.localeCompare(a.id);
  });
}

function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/** Locate a set across all problems — recordAnswer/reset take only a setId. */
function findSet(setId: string): { contentItemId: string; sets: McqSet[]; index: number } | null {
  if (typeof window === 'undefined') return null;
  for (let i = 0; i < window.localStorage.length; i++) {
    const key = window.localStorage.key(i);
    if (!key?.startsWith(STORAGE_PREFIX)) continue;
    const contentItemId = key.slice(STORAGE_PREFIX.length);
    const sets = readSets(contentItemId);
    const index = sets.findIndex((s) => s.id === setId);
    if (index !== -1) return { contentItemId, sets, index };
  }
  return null;
}

export class LocalMcqStore implements McqStore {
  async list(contentItemId: string): Promise<readonly McqSet[]> {
    return sortNewestFirst(readSets(contentItemId));
  }

  async save(input: NewMcqSet): Promise<McqSet> {
    const set: McqSet = {
      id: newId(),
      content_item_id: input.content_item_id,
      model: input.model,
      language: input.language,
      prompt_version: input.prompt_version,
      questions: input.questions,
      answers: [],
      answered_at: null,
      // Load-bearing for the sign-in migration. See McqSet.
      generated_at: new Date().toISOString(),
    };

    const existing = readSets(input.content_item_id);
    // Mirrors the DB trim trigger: keep the newest 5.
    const kept = sortNewestFirst([set, ...existing]).slice(0, MAX_SETS_PER_ITEM);
    writeSets(input.content_item_id, kept);
    return set;
  }

  async recordAnswer(setId: string, index: number, selectedIndex: number): Promise<McqSet> {
    const found = findSet(setId);
    if (!found) throw new Error('set not found');
    const { contentItemId, sets, index: si } = found;
    const set = sets[si];

    if (index < 0 || index >= set.questions.length) throw new Error('bad index');
    if (selectedIndex < 0 || selectedIndex > 3) throw new Error('bad selection');

    // Pad with nulls so out-of-order answering cannot leave holes, matching
    // what record_answer() enforces in SQL.
    const answers = [...set.answers];
    while (answers.length <= index) answers.push(null);
    answers[index] = {
      selected_index: selectedIndex,
      correct: set.questions[index].correct_index === selectedIndex,
    };

    const complete = answers.length >= set.questions.length && answers.every((a) => a !== null);
    const updated: McqSet = {
      ...set,
      answers,
      answered_at: complete ? (set.answered_at ?? new Date().toISOString()) : set.answered_at,
    };

    sets[si] = updated;
    writeSets(contentItemId, sets);
    return updated;
  }

  async reset(setId: string): Promise<McqSet> {
    const found = findSet(setId);
    if (!found) throw new Error('set not found');
    const { contentItemId, sets, index } = found;
    const updated: McqSet = { ...sets[index], answers: [], answered_at: null };
    sets[index] = updated;
    writeSets(contentItemId, sets);
    return updated;
  }

  async remove(setId: string): Promise<void> {
    const found = findSet(setId);
    if (!found) return;
    const { contentItemId, sets, index } = found;
    sets.splice(index, 1);
    writeSets(contentItemId, sets);
  }

  async clear(contentItemId: string): Promise<void> {
    writeSets(contentItemId, []);
  }
}
