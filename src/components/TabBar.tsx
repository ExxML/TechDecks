'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Layers, Search, Bookmark, Settings } from 'lucide-react';

/**
 * Fixed bottom tab bar. Its 48px height is load-bearing: cards are
 * calc(100dvh - 48px) and the snap container is inset by it.
 */
const TABS = [
  { href: '/problems', label: 'Problems', Icon: Layers },
  { href: '/search', label: 'Search', Icon: Search },
  { href: '/bookmarks', label: 'Bookmarks', Icon: Bookmark },
  { href: '/settings', label: 'Settings', Icon: Settings },
] as const;

export function TabBar() {
  const pathname = usePathname();

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-50 flex h-[48px] border-t border-[var(--color-border)] bg-[var(--color-surface)]"
      aria-label="Primary"
    >
      {TABS.map(({ href, label, Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            className="flex flex-1 flex-col items-center justify-center gap-0.5 transition-colors duration-100"
            style={{ color: active ? 'var(--color-accent)' : 'var(--color-text-muted)' }}
          >
            <Icon size={16} strokeWidth={2} aria-hidden="true" />
            <span className="text-[12px] leading-none">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
