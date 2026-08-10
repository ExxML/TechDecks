'use client';

import { useEffect, useState } from 'react';
import { CompactList } from './CompactList';
import { BookmarkButton } from './BookmarkButton';
import { AuthButton } from './AuthButton';
import { createClient } from '@/lib/supabase/client';
import { useUser } from '@/lib/auth';
import { fetchBookmarks } from '@/lib/queries';
import type { ContentItem } from '@/lib/types';

/**
 * Auth-gated: bookmarks are per-user rows behind `bm_all`, so there is nothing
 * to show anonymously. The page offers sign-in rather than an empty list, which
 * would read as "you have none" instead of "sign in first".
 */
export function BookmarksView() {
  const { user, loading: authLoading } = useUser();
  // null = not loaded yet. Derived from the fetch alone, so the signed-out case
  // needs no state write — computing it during render instead of syncing it in
  // an effect is what keeps this off the cascading-render path.
  const [items, setItems] = useState<readonly ContentItem[] | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void fetchBookmarks(createClient())
      .then((rows) => {
        if (!cancelled) setItems(rows);
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  const loading = authLoading || (user !== null && items === null);

  if (loading) {
    return <div className="h-[calc(100dvh-48px)]" aria-hidden="true" />;
  }

  if (!user) {
    return (
      <div className="flex h-[calc(100dvh-48px)] flex-col items-center justify-center gap-3 px-6">
        <p className="text-center text-[14px] text-[var(--color-text-muted)]">
          Sign in to save problems for later.
        </p>
        <AuthButton />
      </div>
    );
  }

  return (
    <CompactList
      items={items ?? []}
      emptyMessage="No bookmarks yet. Tap the bookmark icon on a problem to save it."
      renderAction={(item) => (
        <BookmarkButton
          contentItemId={item.id}
          initialBookmarked
          // Removing from this view drops the row immediately; a list that keeps
          // showing an un-bookmarked problem reads as a failed tap.
          onChange={(bookmarked) => {
            if (!bookmarked) setItems((prev) => (prev ?? []).filter((i) => i.id !== item.id));
          }}
        />
      )}
    />
  );
}
