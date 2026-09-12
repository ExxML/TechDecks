'use client';

import { ResultsView } from './ResultsView';
import { BookmarkButton } from './BookmarkButton';
import { SignInPrompt } from './SignInPrompt';
import { CompactListSkeleton } from './CompactListSkeleton';
import { useUser } from '@/lib/auth';

/**
 * `/bookmarks` — the caller's saved problems, newest first, searchable and
 * filterable exactly as `/search` is. Auth-gated: bookmarks are per-user rows
 * behind `bm_all`, so there is nothing to show anonymously.
 */
export function BookmarksView() {
  const { user, loading } = useUser();

  if (loading) return <CompactListSkeleton />;
  if (!user) return <SignInPrompt message="Sign in to save problems for later." />;

  return (
    <ResultsView
      scope="bookmarks"
      basePath="/bookmarks"
      from="bookmarks"
      emptyMessage="No bookmarks yet. Tap the bookmark icon on a problem to save it."
      renderAction={(hit, drop) => (
        <BookmarkButton
          contentItemId={hit.id}
          initialBookmarked
          // Removing from this view drops the row immediately; a list that keeps
          // showing an un-bookmarked problem reads as a failed tap.
          onChange={(bookmarked) => {
            if (!bookmarked) drop();
          }}
        />
      )}
    />
  );
}
