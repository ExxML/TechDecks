'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Pencil, Trash2 } from 'lucide-react';
import { Button } from './ui/Button';
import { Dialog } from './ui/Dialog';
import { DifficultyBadge } from './ui/Badge';
import { AuthButton } from './AuthButton';
import { ProblemEditor } from './ProblemEditor';
import { createClient } from '@/lib/supabase/client';
import { useUser } from '@/lib/auth';
import {
  createAuthoredProblem,
  deleteAuthoredProblem,
  fetchMyProblems,
  updateAuthoredProblem,
  type AuthoredProblemInput,
} from '@/lib/queries';
import type { ContentItem } from '@/lib/types';

type Mode = { readonly kind: 'list' } | { readonly kind: 'create' } | { readonly kind: 'edit'; readonly item: ContentItem };

/**
 * `/my` — the author's own problems. Private to them by RLS, not by this UI:
 * `ci_read` restricts the query, and a second user calling the API directly
 * gets nothing back.
 *
 * These rows never appear in `/problems`, which is `visibility = 'public'` only.
 */
export function MyProblemsView() {
  const { user, loading: authLoading } = useUser();
  const [items, setItems] = useState<readonly ContentItem[] | null>(null);
  const [mode, setMode] = useState<Mode>({ kind: 'list' });
  const [pendingDelete, setPendingDelete] = useState<ContentItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void fetchMyProblems(createClient())
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

  if (loading) return <div className="h-[calc(100dvh-48px)]" aria-hidden="true" />;

  if (!user) {
    return (
      <div className="flex h-[calc(100dvh-48px)] flex-col items-center justify-center gap-3 px-6">
        <p className="text-center text-[14px] text-[var(--color-text-muted)]">
          Sign in to write your own problems.
        </p>
        <AuthButton />
      </div>
    );
  }

  const reload = async () => {
    setItems(await fetchMyProblems(createClient()));
  };

  const save = async (input: AuthoredProblemInput) => {
    const db = createClient();
    if (mode.kind === 'edit') {
      await updateAuthoredProblem(db, user.id, mode.item.id, mode.item.slug, mode.item.title, input);
    } else {
      await createAuthoredProblem(db, user.id, input);
    }
    await reload();
    setMode({ kind: 'list' });
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await deleteAuthoredProblem(createClient(), user.id, pendingDelete.id);
      await reload();
      setPendingDelete(null);
    } finally {
      setDeleting(false);
    }
  };

  if (mode.kind !== 'list') {
    return (
      <div className="mx-auto h-[calc(100dvh-48px)] max-w-[520px] overflow-y-auto px-4 py-5">
        <h1 className="mb-4 text-[18px] font-medium text-[var(--color-text)]">
          {mode.kind === 'edit' ? 'Edit problem' : 'New problem'}
        </h1>
        <ProblemEditor
          initial={mode.kind === 'edit' ? mode.item : undefined}
          onSave={save}
          onCancel={() => setMode({ kind: 'list' })}
        />
      </div>
    );
  }

  const list = items ?? [];

  return (
    <div className="mx-auto h-[calc(100dvh-48px)] max-w-[520px] overflow-y-auto px-4 py-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h1 className="text-[18px] font-medium text-[var(--color-text)]">My problems</h1>
        <Button variant="primary" onClick={() => setMode({ kind: 'create' })}>
          New
        </Button>
      </div>

      {list.length === 0 ? (
        <p className="mt-8 text-center text-[14px] text-[var(--color-text-muted)]">
          No problems yet. Write one and generate questions against it.
        </p>
      ) : (
        <ul className="flex flex-col">
          {list.map((item) => (
            <li
              key={item.id}
              className="flex items-center gap-3 border-b border-[var(--color-border)] py-3"
            >
              <Link href={`/problems/${item.slug}`} className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="truncate text-[14px] leading-none text-[var(--color-text)]">
                  {item.title}
                </span>
                <span className="flex items-center gap-2 leading-none">
                  <DifficultyBadge difficulty={item.difficulty} />
                  <span className="text-[12px] leading-none text-[var(--color-text-muted)]">
                    {kindCount(item)}
                  </span>
                </span>
              </Link>
              <button
                type="button"
                onClick={() => setMode({ kind: 'edit', item })}
                aria-label={`Edit ${item.title}`}
                className="text-[var(--color-text-muted)] transition-colors duration-100 hover:text-[var(--color-text)]"
              >
                <Pencil size={16} />
              </button>
              <button
                type="button"
                onClick={() => setPendingDelete(item)}
                aria-label={`Delete ${item.title}`}
                className="text-[var(--color-text-muted)] transition-colors duration-100 hover:text-[var(--color-incorrect)]"
              >
                <Trash2 size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Delete is destructive and cascades the problem's generated sets, so it
          is always behind a confirm. */}
      <Dialog
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        title="Delete problem"
      >
        <p className="text-[14px] leading-[1.5] text-[var(--color-text)]">
          Delete “{pendingDelete?.title}”? Its generated question sets are deleted with it. This
          cannot be undone.
        </p>
        <div className="mt-4 flex gap-2">
          <Button
            variant="secondary"
            className="flex-1"
            onClick={() => void confirmDelete()}
            disabled={deleting}
          >
            {deleting ? 'Deleting…' : 'Delete'}
          </Button>
          <Button variant="ghost" onClick={() => setPendingDelete(null)} disabled={deleting}>
            Cancel
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

function kindCount(item: ContentItem): string {
  const n = item.metadata.kinds?.length ?? 0;
  return n === 0 ? 'No kinds set' : `${n} question${n === 1 ? '' : 's'}`;
}
