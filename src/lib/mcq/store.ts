import type { Mcq } from '@/lib/gemini/schema';

/**
 * Every MCQ read and write goes through this interface, so the localStorage and
 * Supabase implementations are interchangeable.
 */

/** One answer, positionally aligned with `questions`. */
export type McqAnswer = {
  readonly selected_index: number;
  readonly correct: boolean;
};

/**
 * Same JSON shape as the mcq_sets DB column, so the sign-in migration carries
 * answer state across untransformed.
 *
 * `generated_at` is load-bearing: the migration orders by it and writes it into
 * `created_at`. Without it every migrated row shares now() and the trim trigger
 * discards an arbitrary five.
 */
export type McqSet = {
  readonly id: string;
  readonly content_item_id: string;
  readonly model: string;
  readonly language: string;
  readonly prompt_version: number;
  readonly questions: readonly Mcq[];
  readonly answers: readonly (McqAnswer | null)[];
  readonly answered_at: string | null;
  readonly generated_at: string;
};

/** What `save` accepts — the store assigns id and generated_at. */
export type NewMcqSet = {
  readonly content_item_id: string;
  readonly model: string;
  readonly language: string;
  readonly prompt_version: number;
  readonly questions: readonly Mcq[];
};

export interface McqStore {
  /** Newest first. */
  list(contentItemId: string): Promise<readonly McqSet[]>;
  save(set: NewMcqSet): Promise<McqSet>;
  /** Returns the updated set so callers never re-derive correctness. */
  recordAnswer(setId: string, index: number, selectedIndex: number): Promise<McqSet>;
  /** Clears every answer in place rather than creating a new set. */
  reset(setId: string): Promise<McqSet>;
  /** Clears one answer, leaving the rest of the set's progress alone. */
  resetAnswer(setId: string, index: number): Promise<McqSet>;
  remove(setId: string): Promise<void>;
  /** Drops every set for one problem. */
  clear(contentItemId: string): Promise<void>;
}

export const MAX_SETS_PER_ITEM = 5;
export const STORAGE_PREFIX = 'techdecks:mcq:';
