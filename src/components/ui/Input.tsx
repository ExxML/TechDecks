import type { InputHTMLAttributes } from 'react';

export function Input({ className = '', ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...rest}
      className={
        'w-full rounded-[4px] border border-[var(--color-border)] bg-[var(--color-surface-alt)] ' +
        'px-3 py-2 text-[14px] text-[var(--color-text)] ' +
        'placeholder:text-[var(--color-text-muted)] ' +
        'focus:border-[var(--color-accent)] focus:outline-none ' +
        `${className}`
      }
    />
  );
}
