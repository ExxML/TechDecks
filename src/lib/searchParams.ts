import { EMPTY_FILTERS, type Difficulty, type SearchFilters } from './types';

/**
 * Filters live in the URL, not in component state.
 *
 * That is what makes a filtered result list shareable and back-button-correct,
 * and it is why applying a filter from the feed navigates to /search with
 * params rather than mutating the feed in place — the feed stays a single
 * unfiltered keyset query whose cursor and prefetch state are never reset.
 *
 * Parsing is total: every malformed value degrades to "no filter" rather than
 * throwing, because these params are user-editable text in an address bar.
 */

const DIFFICULTIES: readonly Difficulty[] = ['easy', 'medium', 'hard'];

function parseList(raw: string | null): string[] {
  if (!raw) return [];
  return [...new Set(raw.split(',').map((s) => s.trim()).filter(Boolean))];
}

/** A percentage, or null. Out-of-range and non-numeric both mean "unset". */
function parsePercent(raw: string | null): number | null {
  if (raw === null || raw.trim() === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return n;
}

export function filtersFromParams(params: URLSearchParams): SearchFilters {
  const difficulties = parseList(params.get('difficulty')).filter((d): d is Difficulty =>
    (DIFFICULTIES as readonly string[]).includes(d),
  );

  const acMin = parsePercent(params.get('acMin'));
  const acMax = parsePercent(params.get('acMax'));

  return {
    ...EMPTY_FILTERS,
    q: params.get('q') ?? '',
    difficulties,
    tags: parseList(params.get('tags')),
    // An inverted range would silently match nothing, which reads as a broken
    // search rather than a bad input. Swap instead.
    acMin: acMin !== null && acMax !== null && acMin > acMax ? acMax : acMin,
    acMax: acMin !== null && acMax !== null && acMin > acMax ? acMin : acMax,
    bookmarkedOnly: params.get('bookmarked') === '1',
  };
}

/** Only non-default values are written, so a bare filter yields a bare URL. */
export function paramsFromFilters(filters: SearchFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.q.trim()) params.set('q', filters.q.trim());
  if (filters.difficulties.length > 0) params.set('difficulty', filters.difficulties.join(','));
  if (filters.tags.length > 0) params.set('tags', filters.tags.join(','));
  if (filters.acMin !== null) params.set('acMin', String(filters.acMin));
  if (filters.acMax !== null) params.set('acMax', String(filters.acMax));
  if (filters.bookmarkedOnly) params.set('bookmarked', '1');
  return params;
}

/** The same filters against another list's route. `/search` by default. */
export function searchHref(filters: SearchFilters, basePath = '/search'): string {
  const qs = paramsFromFilters(filters).toString();
  return qs ? `${basePath}?${qs}` : basePath;
}
