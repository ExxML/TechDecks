'use client';

import { useEffect } from 'react';
import { Sun, Moon, Monitor } from 'lucide-react';
import { useTheme, type Theme } from '@/lib/theme';

const OPTIONS: ReadonlyArray<{ value: Theme; label: string; Icon: typeof Sun }> = [
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'dark', label: 'Dark', Icon: Moon },
  { value: 'system', label: 'System', Icon: Monitor },
];

/**
 * Three-state theme selector.
 *
 * A segmented control rather than a two-state switch, because "follow the OS"
 * is a distinct choice from "dark" and a binary toggle cannot express it.
 */
export function ThemeToggle() {
  const theme = useTheme((s) => s.theme);
  const hydrated = useTheme((s) => s.hydrated);
  const setTheme = useTheme((s) => s.setTheme);
  const hydrate = useTheme((s) => s.hydrate);

  useEffect(() => hydrate(), [hydrate]);

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className="flex gap-2"
      // Until the stored value is read, no option is marked selected — showing
      // "System" as active before knowing would flicker for anyone who chose
      // otherwise.
      aria-busy={!hydrated}
    >
      {OPTIONS.map(({ value, label, Icon }) => {
        const active = hydrated && theme === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => setTheme(value)}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-[4px] border py-2 text-[13px] leading-none transition-colors duration-100"
            style={{
              borderColor: active ? 'var(--color-accent)' : 'var(--color-border)',
              color: active ? 'var(--color-accent)' : 'var(--color-text-muted)',
            }}
          >
            <Icon size={16} aria-hidden="true" />
            {label}
          </button>
        );
      })}
    </div>
  );
}
