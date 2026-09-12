import { pageTitle } from '@/lib/title';
import { Suspense } from 'react';
import { HistoryView } from '@/components/HistoryView';

export const metadata = { title: pageTitle('History') };

export default function HistoryPage() {
  return (
    <Suspense fallback={<div className="h-[calc(100dvh-48px)]" aria-hidden="true" />}>
      <HistoryView />
    </Suspense>
  );
}
