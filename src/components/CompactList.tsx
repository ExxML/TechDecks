'use client';

import Link from 'next/link';
import { DifficultyBadge } from './ui/Badge';
import type { ContentItem } from '@/lib/types';

type Props = {
  readonly items: readonly ContentItem[];
  readonly emptyMessage: string;
  /** Optional action rendered at the right of each row. */
  readonly renderAction?: (item: ContentItem) => React.ReactNode;
};

/**
 * 56px rows, ordinary vertical scrolling, no snap.
 *
 * A 100dvh snap feed is a poor way to read a result list, so `/bookmarks` and
 * `/search` share this layout instead of reusing ProblemFeed.
 */
export function CompactList({ items, emptyMessage, renderAction }: Props) {
  if (items.length === 0) {
    return (
      <div className="flex h-[calc(100dvh-48px)] items-center justify-center px-6">
        <p className="text-center text-[14px] text-[var(--color-text-muted)]">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <ul className="h-[calc(100dvh-48px)] overflow-y-auto">
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
