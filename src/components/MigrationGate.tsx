'use client';

import { useEffect, useRef, useState } from 'react';
import { useUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase/client';
import { migrateLocalSets } from '@/lib/mcq/migrate';
import { useGeneration } from '@/lib/mcq/generation';

/**
 * Runs the localStorage-to-database migration once, on first sign-in.
 *
 * Mounted in the root layout so it fires wherever the user happens to land
 * after the OAuth redirect, not only on Settings.
 *
 * Renders a brief status line while working, then nothing. Silence would be
 * wrong here: up to 150 rows move, and a user who sees no acknowledgement
 * assumes their history was lost.
 */
export function MigrationGate() {
  const { user, loading } = useUser();
  const bumpAll = useGeneration((s) => s.bumpAll);
  const started = useRef(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (loading || !user || started.current) return;
    started.current = true;

    void (async () => {
      try {
        const result = await migrateLocalSets(createClient(), user.id);
        if (result.skipped || result.migratedSets === 0) return;

        setMessage(
          `Moved ${result.migratedSets} question set${result.migratedSets === 1 ? '' : 's'} ` +
            `from this browser to your account.`,
        );
        // Force every mounted card to re-read from the now-Supabase store.
        bumpAll();
        setTimeout(() => setMessage(null), 6000);
      } catch {
        setMessage('Could not move your saved questions to your account.');
        setTimeout(() => setMessage(null), 6000);
      }
    })();
  }, [user, loading, bumpAll]);

  if (!message) return null;

  return (
    <div
      role="status"
      className="fixed inset-x-0 bottom-[48px] z-40 border-t border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2 text-center text-[13px] text-[var(--color-text-muted)]"
    >
      {message}
    </div>
  );
}
