import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  readonly variant?: Variant;
  readonly children: ReactNode;
};

/** 4px radius, 1px borders, no shadow. Orange is reserved for the primary CTA. */
const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-[var(--color-accent)] text-[var(--color-on-accent)] font-medium ' +
    'hover:opacity-90 active:opacity-80 disabled:opacity-40',
  secondary:
    'bg-[var(--color-surface-alt)] text-[var(--color-text)] border border-[var(--color-border)] ' +
    'hover:bg-[var(--color-surface-hover)] active:bg-[var(--color-surface-active)] disabled:opacity-40',
  ghost:
    'bg-transparent text-[var(--color-text-muted)] ' +
    'hover:text-[var(--color-text)] active:opacity-80 disabled:opacity-40',
  // Ghost in every respect but colour. Reserved for actions that discard
  // something the user cannot get back.
  danger:
    'bg-transparent text-[var(--color-danger)] ' +
    'hover:opacity-90 active:opacity-80 disabled:opacity-40',
};

export function Button({ variant = 'primary', className = '', children, ...rest }: Props) {
  return (
    <button
      {...rest}
      className={
        'inline-flex items-center justify-center gap-2 rounded-[4px] px-4 ' +
        'min-h-[40px] text-[14px] leading-none ' +
        'transition-[background-color,opacity,color] duration-100 ' +
        'disabled:cursor-not-allowed ' +
        `${VARIANTS[variant]} ${className}`
      }
    >
      {children}
    </button>
  );
}
