import type { ContentItem } from './types';

/** Per-source builders for a problem's original page. A source absent here
 *  (e.g. authored problems) has no public page to link to. */
const SOURCE_URLS: Record<string, (item: ContentItem) => string> = {
  leetcode: (item) => `https://leetcode.com/problems/${item.slug}/`,
};

/** The problem's public page at its source, or null when it has none —
 *  including paid-only rows, whose page is locked. */
export function sourceUrl(item: ContentItem): string | null {
  if (item.metadata.isPaidOnly) return null;
  return SOURCE_URLS[item.source_id]?.(item) ?? null;
}
