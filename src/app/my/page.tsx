import { pageTitle } from '@/lib/title';
import { MyProblemsView } from '@/components/MyProblemsView';

export const metadata = { title: pageTitle('My problems') };

export default function MyProblemsPage() {
  return <MyProblemsView />;
}
