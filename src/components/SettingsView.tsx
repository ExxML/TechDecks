'use client';

import { useEffect, useState } from 'react';
import { Button } from './ui/Button';
import { Select } from './ui/Select';
import { ApiKeyDialog } from './ApiKeyDialog';
import { useSettings } from '@/lib/settings';
import { useModels } from '@/lib/gemini/useModels';

/**
 * Defaults live here; per-problem overrides live in the Generate sheet, because
 * a problem's selectable languages come from ITS codeSnippets and a global list
 * cannot know them.
 */
export function SettingsView() {
  const { apiKey, model, language, hydrated, hydrate, setModel, setLanguage } = useSettings();
  const [showKeyDialog, setShowKeyDialog] = useState(false);
  const { models, loading, error } = useModels(Boolean(apiKey));

  useEffect(() => hydrate(), [hydrate]);

  return (
    <div className="mx-auto h-[calc(100dvh-48px)] max-w-[520px] overflow-y-auto px-4 py-5">
      <h1 className="text-[18px] font-medium text-[var(--color-text)]">Settings</h1>

      <section className="mt-5">
        <h2 className="text-[13px] font-medium text-[var(--color-text)]">Gemini API key</h2>
        <p className="mt-1 text-[13px] leading-[1.5] text-[var(--color-text-muted)]">
          {!hydrated
            ? ' '
            : apiKey
              ? 'A key is set for this tab. It is cleared when you close the tab.'
              : 'No key set. Questions cannot be generated without one.'}
        </p>
        <div className="mt-2 flex gap-2">
          <Button variant={apiKey ? 'secondary' : 'primary'} onClick={() => setShowKeyDialog(true)}>
            {apiKey ? 'Replace key' : 'Add key'}
          </Button>
        </div>
      </section>

      <section className="mt-6">
        <h2 className="text-[13px] font-medium text-[var(--color-text)]">Default model</h2>
        {!apiKey ? (
          <p className="mt-1 text-[13px] text-[var(--color-text-muted)]">Add a key to load models.</p>
        ) : loading ? (
          <p className="mt-1 text-[13px] text-[var(--color-text-muted)]">Loading models…</p>
        ) : error ? (
          <p className="mt-1 text-[13px] text-[var(--color-incorrect)]">{error}</p>
        ) : (
          <div className="mt-2">
            <Select
              value={model ?? ''}
              onChange={(e) => setModel(e.target.value || null)}
              aria-label="Default model"
            >
              <option value="">Newest Flash model</option>
              {models.map((m) => (
                <option key={m.name} value={m.name}>
                  {m.displayName}
                </option>
              ))}
            </Select>
          </div>
        )}
      </section>

      <section className="mt-6">
        <h2 className="text-[13px] font-medium text-[var(--color-text)]">Default language</h2>
        <p className="mt-1 text-[13px] leading-[1.5] text-[var(--color-text-muted)]">
          Used when a problem offers it. Each problem&rsquo;s own list is shown when you generate.
        </p>
        <div className="mt-2">
          <Select
            value={language ?? 'python3'}
            onChange={(e) => setLanguage(e.target.value)}
            aria-label="Default language"
          >
            {['python3', 'cpp', 'java', 'javascript', 'typescript', 'golang', 'rust', 'csharp'].map(
              (slug) => (
                <option key={slug} value={slug}>
                  {slug}
                </option>
              ),
            )}
          </Select>
        </div>
      </section>

      <section className="mt-6 border-t border-[var(--color-border)] pt-4">
        <p className="text-[12px] leading-[1.5] text-[var(--color-text-muted)]">
          Your key is kept in this tab only and is sent to Google through this site&rsquo;s server on
          each generation. It is never stored on the server or written to logs.
        </p>
      </section>

      <ApiKeyDialog open={showKeyDialog} onClose={() => setShowKeyDialog(false)} />
    </div>
  );
}
