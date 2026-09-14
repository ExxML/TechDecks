'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from './ui/Button';
import { Select } from './ui/Select';
import { ApiKeyDialog } from './ApiKeyDialog';
import { AuthButton } from './AuthButton';
import { ThemeToggle } from './ThemeToggle';
import { useSettings } from '@/lib/settings';
import { DEFAULT_LANGUAGE, LANGUAGES } from '@/lib/languages';
import { useUser } from '@/lib/auth';
import { useModels } from '@/lib/gemini/useModels';
import { clearStoredKey } from '@/lib/gemini/keyStorage';
import { useStoredKey } from '@/lib/gemini/useStoredKey';

/**
 * Defaults live here; per-problem overrides live in the Generate sheet, because
 * a problem's selectable languages come from ITS codeSnippets and a global list
 * cannot know them.
 */
export function SettingsView() {
  const { apiKey, model, language, hydrated, hydrate, setModel, setLanguage } = useSettings();
  const { user } = useUser();
  const signedIn = user !== null;
  const [showKeyDialog, setShowKeyDialog] = useState(false);
  const [clearing, setClearing] = useState(false);
  // Re-checked whenever the key dialog closes.
  const vaultKey = useStoredKey(showKeyDialog);
  const [deleted, setDeleted] = useState(false);
  // Null until the Vault check answers. Treated as "a key may exist" below, so
  // nothing renders the keyless state and then corrects itself.
  const storedKey = deleted ? false : vaultKey;
  const pending = storedKey === null;
  const canLoadModels = Boolean(apiKey) || storedKey === true;
  const { models, loading, error } = useModels(canLoadModels);

  useEffect(() => hydrate(), [hydrate]);

  return (
    <div className="mx-auto h-[calc(100dvh-48px)] max-w-[520px] overflow-y-auto px-4 py-5">
      <h1 className="text-[18px] font-medium text-[var(--color-text)]">Settings</h1>

      <section className="mt-5">
        <h2 className="text-[13px] font-medium text-[var(--color-text)]">Account</h2>
        <p className="mt-1 mb-2 text-[13px] leading-[1.5] text-[var(--color-text-muted)]">
          Signing in saves your questions, bookmarks, and API key across devices.
        </p>
        <AuthButton />
      </section>

      {/* `/my` lives here rather than as a fifth tab: the tab bar's 48px height
          is load-bearing for every card's calc(100dvh - 48px), and a bar that
          changes shape on sign-in would shift that math. */}
      {signedIn && (
        <section className="mt-6">
          <h2 className="text-[13px] font-medium text-[var(--color-text)]">My problems</h2>
          <p className="mt-1 mb-2 text-[13px] leading-[1.5] text-[var(--color-text-muted)]">
            Write your own problems and generate questions against them.
          </p>
          <Link
            href="/my"
            className="inline-flex min-h-[40px] items-center justify-center gap-2 rounded-[4px] border border-[var(--color-border)] bg-[var(--color-surface-alt)] px-4 text-[14px] leading-none text-[var(--color-text)] transition-colors duration-100 hover:bg-[var(--color-surface-hover)]"
          >
            Open my problems
          </Link>
        </section>
      )}

      <section className="mt-6">
        <h2 className="text-[13px] font-medium text-[var(--color-text)]">Gemini API key</h2>
        <p className="mt-1 text-[13px] leading-[1.5] text-[var(--color-text-muted)]">
          {!hydrated || pending
            ? ' '
            : storedKey
              ? 'A key is saved to your account.'
              : apiKey
                ? 'A key is set for this tab. It is cleared when you close the tab.'
                : 'No key set. Questions cannot be generated without one.'}
        </p>
        <div className="mt-2 flex gap-2">
          <Button
            variant={apiKey || storedKey !== false ? 'secondary' : 'primary'}
            disabled={pending}
            onClick={() => setShowKeyDialog(true)}
          >
            {apiKey || storedKey !== false ? 'Replace key' : 'Add key'}
          </Button>
          {/* One-click delete. Drops the vault secret, not just the reference. */}
          {storedKey === true && (
            <Button
              variant="danger"
              disabled={clearing}
              onClick={async () => {
                setClearing(true);
                try {
                  await clearStoredKey();
                  setDeleted(true);
                } finally {
                  setClearing(false);
                }
              }}
            >
              {clearing ? 'Deleting…' : 'Delete stored key'}
            </Button>
          )}
        </div>
      </section>

      <section className="mt-6">
        <h2 className="text-[13px] font-medium text-[var(--color-text)]">Default model</h2>
        {!canLoadModels ? (
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
            value={language ?? DEFAULT_LANGUAGE}
            onChange={(e) => setLanguage(e.target.value)}
            aria-label="Default language"
          >
            {LANGUAGES.map(({ slug, name }) => (
              <option key={slug} value={slug}>
                {name}
              </option>
            ))}
          </Select>
        </div>
      </section>

      <section className="mt-6">
        <h2 className="mb-2 text-[13px] font-medium text-[var(--color-text)]">Theme</h2>
        <ThemeToggle />
      </section>

      <section className="mt-6 border-t border-[var(--color-border)] pt-4">
        <p className="text-[12px] leading-[1.5] text-[var(--color-text-muted)]">
          {storedKey !== false
            ? 'Your key is stored encrypted and is read only by this site’s server, on each generation. It is never sent to your browser and never written to logs. Whoever operates this site can recover it, so use a dedicated key you can revoke.'
            : 'Your key is kept in this tab only and is sent to Google through this site’s server on each generation. It is never stored on the server or written to logs.'}
        </p>
      </section>

      <ApiKeyDialog open={showKeyDialog} onClose={() => setShowKeyDialog(false)} />
    </div>
  );
}
