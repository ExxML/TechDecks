'use client';

import { create } from 'zustand';

/**
 * Theme selection: light, dark, or follow the OS.
 *
 * `system` is the default and is represented by the ABSENCE of the data-theme
 * attribute, so the CSS media query governs. An explicit choice sets the
 * attribute, which wins over the media query.
 *
 * The stored value is read by an inline script in <head> before first paint —
 * see THEME_INIT_SCRIPT. This store handles changes made after hydration.
 */

export type Theme = 'light' | 'dark' | 'system';

export const THEME_STORAGE = 'techdecks:theme';

function isTheme(value: unknown): value is Theme {
  return value === 'light' || value === 'dark' || value === 'system';
}

/** Apply to the document. `system` clears the attribute rather than setting it. */
function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
}

type ThemeState = {
  theme: Theme;
  /** False until the stored value is read, so SSR and first client render agree. */
  hydrated: boolean;
  setTheme: (theme: Theme) => void;
  hydrate: () => void;
};

export const useTheme = create<ThemeState>((set, get) => ({
  theme: 'system',
  hydrated: false,

  setTheme: (theme) => {
    set({ theme });
    applyTheme(theme);
    try {
      window.localStorage.setItem(THEME_STORAGE, theme);
    } catch {
      // Storage unavailable; the choice still applies for this session.
    }
  },

  hydrate: () => {
    if (get().hydrated || typeof window === 'undefined') return;
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(THEME_STORAGE);
    } catch {
      stored = null;
    }
    // The attribute is already correct — the inline script set it before paint.
    // This only syncs the store so the toggle renders the right selection.
    set({ theme: isTheme(stored) ? stored : 'system', hydrated: true });
  },
}));

/**
 * Runs in <head>, before the browser paints anything.
 *
 * Without this the page renders with the default (dark) palette and then
 * corrects itself once React hydrates — a visible flash on every load for any
 * user who chose light. That flash is why this is an inline blocking script
 * rather than an effect.
 *
 * Deliberately tiny and dependency-free. It reads one localStorage key and sets
 * one attribute; a throw here would block rendering, hence the try/catch.
 */
export const THEME_INIT_SCRIPT = `
try {
  var t = localStorage.getItem('${THEME_STORAGE}');
  if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
} catch (e) {}
`.trim();
