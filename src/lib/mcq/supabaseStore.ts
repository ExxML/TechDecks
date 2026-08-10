import type { SupabaseClient } from '@supabase/supabase-js';
import type { Mcq } from '@/lib/gemini/schema';
import type { McqAnswer, McqSet, McqStore, NewMcqSet } from './store';

/**
 * Supabase-backed McqStore. Swapped in for signed-in users.
 *
 * The interface is identical to the localStorage implementation, so no
 * component changes when the provider switches — that is the whole reason the
 * abstraction exists.
 *
 * CORRECTNESS IS COMPUTED IN SQL. `recordAnswer` sends only which option was
 * selected; record_answer() compares it against `correct_index` inside the
 * database. A client-supplied `correct` flag is never trusted, and the
 * guarantee therefore holds even against a direct PostgREST call — which is
 * possible, since the browser holds a real session token.
 */

/** The shape rows come back in. `questions`/`answers` are jsonb. */
type Row = {
  id: string;
  content_item_id: string;
  model: string;
  language: string;
  prompt_version: number;
  questions: unknown;
  answers: unknown;
  answered_at: string | null;
  created_at: string;
};

function toSet(row: Row): McqSet {
  return {
    id: row.id,
    content_item_id: row.content_item_id,
    model: row.model,
    language: row.language,
    prompt_version: row.prompt_version,
    questions: Array.isArray(row.questions) ? (row.questions as Mcq[]) : [],
    answers: Array.isArray(row.answers) ? (row.answers as (McqAnswer | null)[]) : [],
    answered_at: row.answered_at,
    // created_at IS the DB's generated_at. The migration writes each local
    // set's generated_at into created_at precisely so this mapping holds.
    generated_at: row.created_at,
  };
}

const COLUMNS =
  'id, content_item_id, model, language, prompt_version, questions, answers, answered_at, created_at';

export class SupabaseMcqStore implements McqStore {
  constructor(
    private readonly db: SupabaseClient,
    private readonly userId: string,
  ) {}

  async list(contentItemId: string): Promise<readonly McqSet[]> {
    const { data, error } = await this.db
      .from('mcq_sets')
      .select(COLUMNS)
      .eq('content_item_id', contentItemId)
      .eq('user_id', this.userId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false });
    if (error) throw new Error(`could not load sets: ${error.message}`);
    return ((data ?? []) as Row[]).map(toSet);
  }

  async save(input: NewMcqSet): Promise<McqSet> {
    const { data, error } = await this.db
      .from('mcq_sets')
      .insert({
        content_item_id: input.content_item_id,
        user_id: this.userId,
        model: input.model,
        language: input.language,
        prompt_version: input.prompt_version,
        questions: input.questions,
        answers: [],
      })
      .select(COLUMNS)
      .single();
    if (error) throw new Error(`could not save set: ${error.message}`);
    return toSet(data as Row);
  }

  async recordAnswer(setId: string, index: number, selectedIndex: number): Promise<McqSet> {
    // Only the selection travels. The RPC derives correctness in SQL.
    const { error } = await this.db.rpc('record_answer', {
      p_set_id: setId,
      p_index: index,
      p_selected: selectedIndex,
    });
    if (error) throw new Error(`could not record answer: ${error.message}`);
    return this.getById(setId);
  }

  async reset(setId: string): Promise<McqSet> {
    const { error } = await this.db.rpc('reset_answers', { p_set_id: setId });
    if (error) throw new Error(`could not reset: ${error.message}`);
    return this.getById(setId);
  }

  async remove(setId: string): Promise<void> {
    const { error } = await this.db
      .from('mcq_sets')
      .delete()
      .eq('id', setId)
      .eq('user_id', this.userId);
    if (error) throw new Error(`could not delete set: ${error.message}`);
  }

  async clear(contentItemId: string): Promise<void> {
    const { error } = await this.db
      .from('mcq_sets')
      .delete()
      .eq('content_item_id', contentItemId)
      .eq('user_id', this.userId);
    if (error) throw new Error(`could not clear sets: ${error.message}`);
  }

  private async getById(setId: string): Promise<McqSet> {
    const { data, error } = await this.db
      .from('mcq_sets')
      .select(COLUMNS)
      .eq('id', setId)
      .eq('user_id', this.userId)
      .single();
    if (error) throw new Error(`could not reload set: ${error.message}`);
    return toSet(data as Row);
  }
}
