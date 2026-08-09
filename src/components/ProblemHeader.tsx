import { DifficultyBadge } from './ui/Badge';
import type { ContentItem } from '@/lib/types';

/**
 * The density cap for the card.
 *
 * Title, difficulty, acRate, and AT MOST 3 tags. Nothing else — no likes,
 * dislikes, model, or history chips. Adding a row here is what turns the card
 * into a dashboard.
 */
export function ProblemHeader({ item }: { readonly item: ContentItem }) {
  const acRate = item.metadata.acRate;
  const tags = item.tags.slice(0, 3);

  return (
    <div className="px-4 pt-4 pb-3">
      <h2 className="text-[18px] leading-tight font-medium text-[var(--color-text)]">
        {item.sort_key !== null && (
          <span className="text-[var(--color-text-muted)]">{item.sort_key}. </span>
        )}
        {item.title}
      </h2>

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
            <li
              key={t.slug}
              className="rounded-[4px] border border-[var(--color-border)] bg-[var(--color-surface-alt)] px-1.5 py-0.5 text-[12px] leading-none text-[var(--color-text-muted)]"
            >
              {t.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
