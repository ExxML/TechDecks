'use client';

import { create } from 'zustand';
import type { Mcq } from '@/lib/gemini/schema';
import { LocalMcqStore } from './localStore';
import type { McqSet, McqStore } from './store';

/**
 * Generation state, keyed by contentItemId. Store-level rather than
 * component-local so swiping away from a card does not unmount — and abort — a
 * request the user is paying tokens for.
 */

/** Swapped for the Supabase implementation once auth exists. */
export const mcqStore: McqStore = new LocalMcqStore();

type Status = 'idle' | 'generating' | 'error';

type GenerationState = {
  statusByItem: Readonly<Record<string, Status>>;
  errorByItem: Readonly<Record<string, string | null>>;
  /** Bumped whenever a problem's sets change, so views can re-read the store. */
  versionByItem: Readonly<Record<string, number>>;
  generate: (args: GenerateArgs) => Promise<McqSet | null>;
  bump: (contentItemId: string) => void;
  clearError: (contentItemId: string) => void;
};

export type GenerateArgs = {
  readonly contentItemId: string;
  readonly apiKey: string;
  readonly model: string;
  readonly language: string | null;
  readonly kinds: readonly string[];
};

export const useGeneration = create<GenerationState>((set, get) => ({
  statusByItem: {},
  errorByItem: {},
  versionByItem: {},

  bump: (contentItemId) =>
    set((s) => ({
      versionByItem: {
        ...s.versionByItem,
        [contentItemId]: (s.versionByItem[contentItemId] ?? 0) + 1,
      },
    })),

  clearError: (contentItemId) =>
    set((s) => ({ errorByItem: { ...s.errorByItem, [contentItemId]: null } })),

  generate: async ({ contentItemId, apiKey, model, language, kinds }) => {
    if (get().statusByItem[contentItemId] === 'generating') return null;

    set((s) => ({
      statusByItem: { ...s.statusByItem, [contentItemId]: 'generating' },
      errorByItem: { ...s.errorByItem, [contentItemId]: null },
    }));

    try {
      const res = await fetch('/api/gemini/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // The key travels in a header to OUR route, which forwards it to
          // Google. It is never put in a URL, where it would land in logs.
          'x-gemini-key': apiKey,
        },
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
      const saved = await mcqStore.save({
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
