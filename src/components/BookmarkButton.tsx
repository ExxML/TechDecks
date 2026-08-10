'use client';

import { useEffect, useState } from 'react';
import { Bookmark } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useUser } from '@/lib/auth';
import { addBookmark, removeBookmark, fetchBookmarkedIds } from '@/lib/queries';

type Props = {
  readonly contentItemId: string;
  /** Supplied by list views that already know the state, so each row does not
   *  issue its own query. The feed omits it and this component looks it up. */
  readonly initialBookmarked?: boolean;
  readonly onChange?: (bookmarked: boolean) => void;
};

/**
 * Bookmarking requires a session — `bm_all` is `to authenticated`, so an
 * anonymous write would be rejected by RLS. Rather than fail on tap, the button
 * is simply not rendered when signed out.
 *
 * The optimistic flip is reverted if the write fails, so the icon never claims
 * a bookmark the database does not have.
 */
export function BookmarkButton({ contentItemId, initialBookmarked, onChange }: Props) {
  const { user } = useUser();
  const [bookmarked, setBookmarked] = useState(initialBookmarked ?? false);
  const [known, setKnown] = useState(initialBookmarked !== undefined);
  const [busy, setBusy] = useState(false);

  // Only runs when the parent did not already know the state.
  useEffect(() => {
    if (initialBookmarked !== undefined || !user) return;
    let cancelled = false;
    void fetchBookmarkedIds(createClient(), [contentItemId])
      .then((ids) => {
        if (cancelled) return;
        setBookmarked(ids.has(contentItemId));
        setKnown(true);
      })
      .catch(() => {
        if (!cancelled) setKnown(true);
      });
    return () => {
      cancelled = true;
    };
  }, [contentItemId, initialBookmarked, user]);

  if (!user) return null;

  const toggle = async () => {
    if (busy || !known) return;
    const next = !bookmarked;
    setBookmarked(next);
    setBusy(true);
    try {
      const db = createClient();
      if (next) await addBookmark(db, user.id, contentItemId);
      else await removeBookmark(db, user.id, contentItemId);
      onChange?.(next);
    } catch {
      setBookmarked(!next); // the write failed; do not claim it succeeded
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={() => void toggle()}
      aria-pressed={bookmarked}
      aria-label={bookmarked ? 'Remove bookmark' : 'Add bookmark'}
      className="flex h-8 w-8 items-center justify-center transition-colors duration-100"
      style={{ color: bookmarked ? 'var(--color-accent)' : 'var(--color-text-muted)' }}
    >
      <Bookmark size={16} fill={bookmarked ? 'var(--color-accent)' : 'none'} aria-hidden="true" />
    </button>
  );
}
