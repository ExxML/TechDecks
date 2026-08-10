import type { Metadata, Viewport } from 'next';
import './globals.css';
import { TabBar } from '@/components/TabBar';
import { MigrationGate } from '@/components/MigrationGate';

export const metadata: Metadata = {
  title: 'TechDecks',
  description: 'Practice technical interview problems without typing code.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Do not lock zoom — pinch-zoom is an accessibility requirement, and the
  // layout is built to tolerate it.
  themeColor: '#1a1a1a',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en">
      <body>
        {/* The tab bar is fixed and 48px; every scroll container is sized
            calc(100dvh - 48px) so nothing hides behind it. */}
        <main>{children}</main>
        {/* Mounted at the root so the sign-in migration runs wherever the OAuth
            redirect lands, not only on Settings. */}
        <MigrationGate />
        <TabBar />
      </body>
    </html>
  );
}
