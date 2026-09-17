'use client';

import { useState } from 'react';
import { Dialog } from '../ui/Dialog';
import { Select } from '../ui/Select';
import { Button } from '../ui/Button';
import { KindEditor } from '../KindEditor';
import { useSettings } from '@/lib/settings';
import { useModels } from '@/lib/gemini/useModels';
import { useStoredKey } from '@/lib/gemini/useStoredKey';
import { DEFAULT_LANGUAGE, languageName } from '@/lib/languages';
import type { CodeSnippet } from '@/lib/types';

type Props = {
  readonly open: boolean;
  readonly onClose: () => void;
  /** From THIS problem's codeSnippets — a global list cannot be the only source,
   *  because only these languages have a real signature to pin against. */
  readonly snippets: readonly CodeSnippet[];
  /** This problem's kinds, the starting point for the editor below. */
  readonly kinds: readonly string[];
  readonly onConfirm: (model: string, language: string | null, kinds: readonly string[]) => void;
};

/**
 * Default language for a problem: the user's preference when this problem
 * offers it, otherwise DEFAULT_LANGUAGE, otherwise the first entry.
 *
 * Computed during render rather than synced into state by an effect — it is
 * derived data, and an effect would cause a cascading render.
 */
function defaultLanguageFor(
  snippets: readonly CodeSnippet[],
  preferred: string | null,
): string | null {
  if (snippets.length === 0) return null;
  const has = (slug: string | null) => !!slug && snippets.some((s) => s.langSlug === slug);
  if (has(preferred)) return preferred;
  if (has(DEFAULT_LANGUAGE)) return DEFAULT_LANGUAGE;
  return snippets[0].langSlug;
}

export function GenerateOptionsSheet({ open, onClose, snippets, kinds, onConfirm }: Props) {
  const { model: defaultModel, language: defaultLanguage, setModel, setLanguage } = useSettings();
  const apiKey = useSettings((s) => s.apiKey);
  // Either source counts: a pasted key for this tab, or one stored in Vault
  // that the server reads on our behalf.
  const vaultKey = useStoredKey();
  const { models, loading, error, defaultModelName } = useModels(
    open && (Boolean(apiKey) || vaultKey === true),
  );

  // Overrides only. Null means "use the derived default", so a changing
  // snippet list or a late-arriving model list is picked up without an effect.
  const [modelOverride, setModelOverride] = useState<string | null>(null);
  const [langOverride, setLangOverride] = useState<string | null>(null);
  const [kindsOverride, setKindsOverride] = useState<readonly string[] | null>(null);

  const effectiveModel = modelOverride ?? defaultModel ?? defaultModelName;
  const effectiveLang = langOverride ?? defaultLanguageFor(snippets, defaultLanguage);
  const effectiveKinds = kindsOverride ?? kinds;

  // Kind edits apply to one generation only, so the sheet reopens on the
  // problem's own kinds however it was dismissed.
  const close = () => {
    setKindsOverride(null);
    onClose();
  };

  const confirm = () => {
    if (!effectiveModel || effectiveKinds.length === 0) return;
    setModel(effectiveModel);
    if (effectiveLang) setLanguage(effectiveLang);
    close();
    onConfirm(effectiveModel, effectiveLang, effectiveKinds);
  };

  return (
    <Dialog open={open} onClose={close} title="Generate questions">
      <label className="mb-1.5 block text-[12px] text-[var(--color-text-muted)]">Model</label>
      {loading && <p className="text-[13px] text-[var(--color-text-muted)]">Loading models…</p>}
      {error && <p className="text-[13px] text-[var(--color-incorrect)]">{error}</p>}
      {/* An empty Select would render as a blank, unopenable field. */}
      {!loading && !error && models.length === 0 && (
        <p className="text-[13px] text-[var(--color-text-muted)]">No models available.</p>
      )}
      {!loading && !error && models.length > 0 && (
        <Select
          value={effectiveModel ?? ''}
          onChange={(e) => setModelOverride(e.target.value)}
          aria-label="Model"
        >
          {models.map((m) => (
            <option key={m.name} value={m.name}>
              {m.displayName}
            </option>
          ))}
        </Select>
      )}

      {/* Hidden entirely for authored problems, which have no codeSnippets. */}
      {snippets.length > 0 && (
        <>
          <label className="mt-3 mb-1.5 block text-[12px] text-[var(--color-text-muted)]">
            Language
          </label>
          <Select
            value={effectiveLang ?? ''}
            onChange={(e) => setLangOverride(e.target.value)}
            aria-label="Language"
          >
            {snippets.map((s) => (
              <option key={s.langSlug} value={s.langSlug}>
                {languageName(s.langSlug)}
              </option>
            ))}
          </Select>
        </>
      )}

      <label className="mt-3 mb-1.5 block text-[12px] text-[var(--color-text-muted)]">
        Questions
      </label>
      <KindEditor kinds={effectiveKinds} onChange={setKindsOverride} />

      <Button
        variant="primary"
        className="mt-4 w-full"
        onClick={confirm}
        disabled={!effectiveModel || loading || effectiveKinds.length === 0}
      >
        Generate
      </Button>
    </Dialog>
  );
}
