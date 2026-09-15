import Link from 'next/link';
import { DifficultyBadge } from './ui/Badge';
import { BookmarkButton } from './BookmarkButton';
import { searchHref } from '@/lib/searchParams';
import { EMPTY_FILTERS, type ContentItem } from '@/lib/types';

/**
 * The card's density cap: title, difficulty, acRate, bookmark, and at most 3
 * tags. Nothing else — another row here turns the card into a dashboard.
 *
 * Scrolls away with the description: it is the first block inside the body
 * scroller, so it inherits that scroller's horizontal padding.
 */
export function ProblemHeader({ item }: { readonly item: ContentItem }) {
  const acRate = item.metadata.acRate;
  const tags = item.tags.slice(0, 3);

  return (
    <div className="pt-4 pb-3">
      <div className="flex items-start gap-2">
        <h2 className="min-w-0 flex-1 text-[18px] leading-tight font-medium text-[var(--color-text)]">
          {item.sort_key !== null && (
            <span className="text-[var(--color-text-muted)]">{item.sort_key}. </span>
          )}
          {item.title}
        </h2>
        {/* Renders nothing when signed out — bookmarks are an authenticated
            write, so a tappable icon there would only ever fail. */}
        <BookmarkButton contentItemId={item.id} />
      </div>

      <div className="mt-2 flex items-center gap-3">
        <DifficultyBadge difficulty={item.difficulty} />
        {typeof acRate === 'number' && (
          <span className="text-[12px] leading-none text-[var(--color-text-muted)]">
            {acRate.toFixed(1)}% accepted
          </span>
        )}
      </div>

      {tags.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {tags.map((t) => (
            <li key={t.slug}>
              {/* Navigates to /search rather than filtering the feed in place,
                  so the feed's cursor is never reset. */}
              <Link
                href={searchHref({ ...EMPTY_FILTERS, tags: [t.slug] })}
                className="block rounded-[4px] border border-[var(--color-border)] bg-[var(--color-surface-alt)] px-1.5 py-0.5 text-[12px] leading-none text-[var(--color-text-muted)] transition-colors duration-100 hover:text-[var(--color-text)]"
                draggable={false}
              >
                {t.name}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
