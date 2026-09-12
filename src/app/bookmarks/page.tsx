import { pageTitle } from '@/lib/title';
import { BookmarksView } from '@/components/BookmarksView';

export const metadata = { title: pageTitle('Bookmarks') };

export default function BookmarksPage() {
  return <BookmarksView />;
}
