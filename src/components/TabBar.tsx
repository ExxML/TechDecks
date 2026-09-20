'use client';

import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { Layers, Search, History, Bookmark, Settings } from 'lucide-react';
import { feedHref } from '@/lib/feedSession';
import { listHref } from '@/lib/listSession';

/**
 * Fixed bottom tab bar. Its 48px height is load-bearing: cards are
 * calc(100dvh - 48px) and the snap container is inset by it.
 */
const TABS = [
  { href: '/problems', label: 'Problems', Icon: Layers },
  { href: '/search', label: 'Search', Icon: Search },
  { href: '/history', label: 'History', Icon: History },
  { href: '/bookmarks', label: 'Bookmarks', Icon: Bookmark },
  { href: '/settings', label: 'Settings', Icon: Settings },
] as const;

/** Where a tab leads: the route as that tab was last left showing. */
function remembered(href: string): string {
  return href === '/problems' ? feedHref() : listHref(href);
}

export function TabBar() {
  const pathname = usePathname();
  const router = useRouter();

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-50 flex h-[48px] border-t border-[var(--color-border)] bg-[var(--color-surface)]"
      aria-label="Primary"
      // The bar is a row of tap targets, never a scroll surface: without this a
      // drag across it pans the page itself, shifting the frame behind it.
      style={{ touchAction: 'none' }}
    >
      {TABS.map(({ href, label, Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            // Result lists carry their filters in the URL, and the feed carries
            // its card, so returning to a tab means returning to what it was
            // left showing.
            //
            // Resolved on click rather than during render: the bar lives in the
            // root layout and stays mounted, so a href baked in at render time
            // would still point at wherever the reader was when it last drew.
            href={remembered(href)}
            onNavigate={(e) => {
              e.preventDefault();
              router.push(remembered(href));
            }}
            aria-current={active ? 'page' : undefined}
            className="flex flex-1 flex-col items-center justify-center gap-1 transition-colors duration-100"
            style={{ color: active ? 'var(--color-accent)' : 'var(--color-text-muted)' }}
            draggable={false}
          >
            <Icon size={16} strokeWidth={2} aria-hidden="true" />
            <span className="text-[12px] leading-none">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
