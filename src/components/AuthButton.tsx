'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from './ui/Button';
import { useUser, signInWithGoogle, signOut } from '@/lib/auth';
import { resetMcqStore } from '@/lib/mcq/provider';
import { useGeneration } from '@/lib/mcq/generation';

/**
 * Google sign-in / sign-out. Google is the only provider.
 */
export function AuthButton() {
  const { user, loading } = useUser();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const bumpAll = useGeneration((s) => s.bumpAll);

  if (loading) {
    return <div className="h-[40px]" aria-hidden="true" />;
  }

  if (!user) {
    return (
      <Button
        variant="secondary"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void signInWithGoogle('/settings');
        }}
      >
        {busy ? 'Redirecting…' : 'Sign in with Google'}
      </Button>
    );
  }

  return (
    <div className="flex items-center justify-between gap-3">
      <span className="min-w-0 truncate text-[13px] text-[var(--color-text-muted)]">
        {user.email}
      </span>
      <Button
        variant="danger"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          await signOut();
          // Drop the cached per-user store, and the sets read through it, so
          // neither outlives the session they belong to.
          resetMcqStore();
          bumpAll();
          router.push('/problems');
          // Server Components cached the signed-in session; refresh re-renders
          // them against the now-anonymous one.
          router.refresh();
        }}
      >
        Sign out
      </Button>
    </div>
  );
}
