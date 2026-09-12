'use client';

import { AuthButton } from './AuthButton';

/**
 * The signed-out state of a per-user list. Bookmarks and history are rows
 * behind RLS, so there is nothing to show anonymously — these pages offer
 * sign-in rather than an empty list, which would read as "you have none"
 * instead of "sign in first".
 */
export function SignInPrompt({ message }: { readonly message: string }) {
  return (
    <div className="flex h-[calc(100dvh-48px)] flex-col items-center justify-center gap-3 px-6">
      <p className="text-center text-[14px] text-[var(--color-text-muted)]">{message}</p>
      <AuthButton />
    </div>
  );
}
