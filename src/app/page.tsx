import { redirect } from 'next/navigation';

/** The feed is the front door. No landing page. */
export default function Home() {
  redirect('/problems');
}
