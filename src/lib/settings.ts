'use client';

import { create } from 'zustand';

/**
 * Client settings. The Gemini key lives in sessionStorage so it dies with the
 * tab; model and language live in localStorage, being no secret. A signed-in
 * user's key lives in Supabase Vault instead.
 */

const KEY_STORAGE = 'techdeck:gemini-key'; // sessionStorage
const PREF_STORAGE = 'techdeck:prefs'; // localStorage

type Prefs = {
  model: string | null;
  language: string | null;
};

type SettingsState = {
  apiKey: string | null;
  model: string | null;
  language: string | null;
  /** False until the browser values have been read, so SSR and the first
   *  client render agree and React does not warn about a hydration mismatch. */
  hydrated: boolean;
  setApiKey: (key: string | null) => void;
  setModel: (model: string | null) => void;
  setLanguage: (language: string | null) => void;
  hydrate: () => void;
};

function readPrefs(): Prefs {
  if (typeof window === 'undefined') return { model: null, language: null };
  try {
    const raw = window.localStorage.getItem(PREF_STORAGE);
    if (!raw) return { model: null, language: null };
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return { model: null, language: null };
    const p = parsed as Partial<Prefs>;
    return {
      model: typeof p.model === 'string' ? p.model : null,
      language: typeof p.language === 'string' ? p.language : null,
    };
  } catch {
    return { model: null, language: null };
  }
}

function writePrefs(prefs: Prefs): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PREF_STORAGE, JSON.stringify(prefs));
  } catch {
    // Storage unavailable; preferences simply will not persist.
  }
}

export const useSettings = create<SettingsState>((set, get) => ({
  apiKey: null,
  model: null,
  language: null,
  hydrated: false,

  setApiKey: (key) => {
    set({ apiKey: key });
    if (typeof window === 'undefined') return;
    try {
      if (key) window.sessionStorage.setItem(KEY_STORAGE, key);
      else window.sessionStorage.removeItem(KEY_STORAGE);
    } catch {
      // Key still works for this render; it just will not survive a reload.
    }
  },

  setModel: (model) => {
    set({ model });
    writePrefs({ model, language: get().language });
  },

  setLanguage: (language) => {
    set({ language });
    writePrefs({ model: get().model, language });
  },

  hydrate: () => {
    if (get().hydrated || typeof window === 'undefined') return;
    let apiKey: string | null = null;
    try {
      apiKey = window.sessionStorage.getItem(KEY_STORAGE);
    } catch {
      apiKey = null;
    }
    const prefs = readPrefs();
    set({ apiKey, model: prefs.model, language: prefs.language, hydrated: true });
  },
}));
