/**
 * Loading placeholder. Opacity pulse only — no shimmer sweep, no gradient.
 */
export function Skeleton({ className = '' }: { readonly className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-[4px] bg-[var(--color-surface-alt)] ${className}`}
      aria-hidden="true"
    />
  );
}
