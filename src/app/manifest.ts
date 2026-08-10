import type { MetadataRoute } from 'next';

/**
 * PWA manifest, so the app installs to a home screen and opens without browser
 * chrome — which is what makes the `calc(100dvh - 48px)` card math land exactly
 * on a phone rather than fighting a URL bar.
 *
 * `display: standalone` rather than fullscreen: the status bar stays, and the
 * feed is not the kind of app that should hide the clock.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'TechDecks',
    short_name: 'TechDecks',
    description: 'Practice technical interview problems without typing code.',
    start_url: '/problems',
    // The feed is the front door — an installed icon opens straight into it,
    // not onto a redirect from '/'.
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#1a1a1a',
    theme_color: '#1a1a1a',
    categories: ['education', 'productivity'],
    icons: [
      {
        src: '/icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'any',
      },
      {
        src: '/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        // Maskable icons are re-cropped by the launcher, so this one carries
        // its own padding; reusing the plain icon here gets the edges shaved.
        src: '/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
