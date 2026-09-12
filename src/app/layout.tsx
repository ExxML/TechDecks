import type { Metadata, Viewport } from 'next';
import './globals.css';
import { TabBar } from '@/components/TabBar';
import { MigrationGate } from '@/components/MigrationGate';
import { THEME_INIT_SCRIPT } from '@/lib/theme';

export const metadata: Metadata = {
  title: 'TechDecks',
  description: 'Practice technical interview problems without typing code.',
  manifest: '/manifest.webmanifest',
  // Declared explicitly so the tab icon is the app's own mark rather than
  // whatever /favicon.ico the host serves by default.
  icons: {
    icon: [{ url: '/icon.svg', type: 'image/svg+xml' }],
    apple: '/apple-icon.png',
  },
  appleWebApp: {
    capable: true,
    title: 'TechDecks',
    statusBarStyle: 'black-translucent',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Do not lock zoom — pinch-zoom is an accessibility requirement, and the
  // layout is built to tolerate it.
  viewportFit: 'cover',
  // Two entries, so the browser chrome matches whichever palette is showing.
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#1a1a1a' },
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
  ],
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Sets data-theme BEFORE first paint. Without it, a user who chose
            light sees a dark flash on every load while React hydrates. The
            attribute is written by this script, so the server-rendered HTML
            never matches it — hence suppressHydrationWarning on <html>. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
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
