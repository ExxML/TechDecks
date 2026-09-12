'use client';

import { ResultsView } from './ResultsView';

/** `/search` — the whole catalog. See ResultsView for the shared machinery. */
export function SearchView() {
  return (
    <ResultsView
      scope="catalog"
      basePath="/search"
      from="search"
      emptyMessage="Search the problem catalog."
    />
  );
}
