import { pageTitle } from '@/lib/title';
import { Suspense } from 'react';
import { SearchView } from '@/components/SearchView';

export const metadata = { title: pageTitle('Search') };

/**
 * `useSearchParams` opts a client component into request-time rendering, which
 * Next requires be wrapped in Suspense. The fallback is a blank pane rather
 * than a spinner: the search box paints immediately after it.
 */
export default function SearchPage() {
  return (
    <Suspense fallback={<div className="h-[calc(100dvh-48px)]" aria-hidden="true" />}>
      <SearchView />
    </Suspense>
  );
}
