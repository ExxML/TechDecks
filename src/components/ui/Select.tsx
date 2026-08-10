import type { SelectHTMLAttributes } from 'react';

/**
 * Native <select>. Deliberately not a custom listbox: the native control gets
 * correct mobile behaviour, keyboard support, and accessibility for free, and
 * a hand-rolled dropdown is where the "AI-generated" look usually creeps in.
 */
export function Select({ className = '', children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...rest}
      className={
        'w-full appearance-none rounded-[4px] border border-[var(--color-border)] ' +
        'bg-[var(--color-surface-alt)] px-3 py-2 text-[14px] text-[var(--color-text)] ' +
        'focus:border-[var(--color-accent)] focus:outline-none ' +
        `${className}`
      }
    >
      {children}
    </select>
  );
}
