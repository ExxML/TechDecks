'use client';

import Link from 'next/link';
import { DifficultyBadge } from './ui/Badge';
import type { Difficulty, LeetCodeMetadata } from '@/lib/types';

/**
 * The minimum a row needs, satisfied by both `ContentItem` and `SearchHit`.
 * The search RPC returns no tags and no body, so requiring ContentItem here
 * would force those callers to invent empty values.
 */
export type CompactListItem = {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly difficulty: Difficulty | null;
  readonly metadata: LeetCodeMetadata;
  readonly sort_key: number | null;
};

type Props = {
  readonly items: readonly CompactListItem[];
  readonly emptyMessage: string;
  /** Optional action rendered at the right of each row. */
  readonly renderAction?: (item: CompactListItem) => React.ReactNode;
  /** False when the parent owns the scroll container, as /search does. */
  readonly scrollable?: boolean;
};

/**
 * 56px rows, ordinary vertical scrolling, no snap.
 *
 * A 100dvh snap feed is a poor way to read a result list, so `/bookmarks` and
 * `/search` share this layout instead of reusing ProblemFeed.
 */
export function CompactList({ items, emptyMessage, renderAction, scrollable = true }: Props) {
  if (items.length === 0) {
    // An empty message is only meaningful when this component owns the viewport;
    // /search renders its own richer empty state with a Clear action.
    if (!emptyMessage) return null;
    return (
      <div className="flex h-[calc(100dvh-48px)] items-center justify-center px-6">
        <p className="text-center text-[14px] text-[var(--color-text-muted)]">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <ul className={scrollable ? 'h-[calc(100dvh-48px)] overflow-y-auto' : undefined}>
      {items.map((item) => (
        <li key={item.id} className="border-b border-[var(--color-border)]">
          <div className="flex h-[56px] items-center gap-3 px-4">
            <Link href={`/problems/${item.slug}`} className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="truncate text-[14px] leading-none text-[var(--color-text)]">
                {item.sort_key !== null && (
                  <span className="text-[var(--color-text-muted)]">{item.sort_key}. </span>
                )}
                {item.title}
              </span>
              <span className="flex items-center gap-2 leading-none">
                <DifficultyBadge difficulty={item.difficulty} />
                {typeof item.metadata.acRate === 'number' && (
                  <span className="text-[12px] leading-none text-[var(--color-text-muted)]">
                    {item.metadata.acRate.toFixed(1)}%
                  </span>
                )}
              </span>
            </Link>
            {renderAction?.(item)}
          </div>
        </li>
      ))}
    </ul>
  );
}
