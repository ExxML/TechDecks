'use client';

import { create } from 'zustand';
import type { Mcq } from '@/lib/gemini/schema';
import type { McqSet, McqStore } from './store';

/**
 * Generation state, keyed by contentItemId. Store-level rather than
 * component-local so swiping away from a card does not unmount — and abort — a
 * request the user is paying tokens for.
 *
 * The McqStore is passed in per call rather than held here, because which
 * implementation applies depends on the session: see getMcqStore().
 */

type Status = 'idle' | 'generating' | 'error';

type GenerationState = {
  statusByItem: Readonly<Record<string, Status>>;
  errorByItem: Readonly<Record<string, string | null>>;
  /** Epoch ms the in-flight request started, for the elapsed counter. Lives
   *  here rather than in the card so unmounting mid-generation does not
   *  restart the clock. */
  startedAtByItem: Readonly<Record<string, number>>;
  /** Last sets read for a problem, so a card remounting — toggling between
   *  reading and questions, or paging back into the window — renders them on
   *  its first frame instead of an empty list awaiting an async read. Absent
   *  means never read, which is not the same as read and empty. */
  setsByItem: Readonly<Record<string, readonly McqSet[]>>;
  /** Bumped whenever a problem's sets change, so views can re-read the store. */
  versionByItem: Readonly<Record<string, number>>;
  /** Bumped when EVERY problem's sets may have changed at once — the sign-in
   *  migration, or a store swap. Per-item bumps cannot express that. */
  globalVersion: number;
  generate: (args: GenerateArgs) => Promise<McqSet | null>;
  bump: (contentItemId: string) => void;
  bumpAll: () => void;
  /** Records what a read returned, for the next mount to start from. */
  cacheSets: (contentItemId: string, sets: readonly McqSet[]) => void;
  clearError: (contentItemId: string) => void;
};

export type GenerateArgs = {
  readonly contentItemId: string;
  /** Anonymous only. Signed-in users' keys are read server-side from Vault, so
   *  the browser never holds one and this is null. */
  readonly apiKey: string | null;
  readonly model: string;
  readonly language: string | null;
  readonly kinds: readonly string[];
  /** Where to persist the result. The route returns; the caller persists. */
  readonly store: McqStore;
};

export const useGeneration = create<GenerationState>((set, get) => ({
  statusByItem: {},
  errorByItem: {},
  startedAtByItem: {},
  setsByItem: {},
  versionByItem: {},
  globalVersion: 0,

  // Cached sets came from the outgoing store, so they are dropped rather than
  // re-served while the re-read runs.
  bumpAll: () => set((s) => ({ globalVersion: s.globalVersion + 1, setsByItem: {} })),

  cacheSets: (contentItemId, sets) =>
    set((s) => ({ setsByItem: { ...s.setsByItem, [contentItemId]: sets } })),

  bump: (contentItemId) =>
    set((s) => ({
      versionByItem: {
        ...s.versionByItem,
        [contentItemId]: (s.versionByItem[contentItemId] ?? 0) + 1,
      },
    })),

  clearError: (contentItemId) =>
    set((s) => ({ errorByItem: { ...s.errorByItem, [contentItemId]: null } })),

  generate: async ({ contentItemId, apiKey, model, language, kinds, store }) => {
    if (get().statusByItem[contentItemId] === 'generating') return null;

    set((s) => ({
      statusByItem: { ...s.statusByItem, [contentItemId]: 'generating' },
      errorByItem: { ...s.errorByItem, [contentItemId]: null },
      startedAtByItem: { ...s.startedAtByItem, [contentItemId]: Date.now() },
    }));

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      // Anonymous only. A signed-in user's key is read server-side from Vault
      // using their verified session, so it never reaches the browser and
      // there is nothing to send.
      if (apiKey) headers['x-gemini-key'] = apiKey;

      const res = await fetch('/api/gemini/generate', {
        method: 'POST',
        headers,
        body: JSON.stringify({ contentItemId, model, language, kinds }),
      });

      const payload: unknown = await res.json().catch(() => null);

      if (!res.ok) {
        const message =
          typeof payload === 'object' && payload !== null && typeof (payload as { error?: unknown }).error === 'string'
            ? (payload as { error: string }).error
            : 'Generation failed — try again';
        set((s) => ({
          statusByItem: { ...s.statusByItem, [contentItemId]: 'error' },
          errorByItem: { ...s.errorByItem, [contentItemId]: message },
        }));
        return null;
      }

      const data = payload as {
        questions: Mcq[];
        model: string;
        language: string | null;
        prompt_version: number;
      };

      // The route returns; the CALLER persists. That contract is what keeps the
      // route stateless.
      const saved = await store.save({
        content_item_id: contentItemId,
        model: data.model,
        language: data.language ?? 'text',
        prompt_version: data.prompt_version,
        questions: data.questions,
      });

      set((s) => ({
        statusByItem: { ...s.statusByItem, [contentItemId]: 'idle' },
        versionByItem: {
          ...s.versionByItem,
          [contentItemId]: (s.versionByItem[contentItemId] ?? 0) + 1,
        },
      }));
      return saved;
    } catch {
      set((s) => ({
        statusByItem: { ...s.statusByItem, [contentItemId]: 'error' },
        errorByItem: { ...s.errorByItem, [contentItemId]: 'Generation failed — try again' },
      }));
      return null;
    }
  },
}));
