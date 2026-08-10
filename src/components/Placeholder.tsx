/** Stub for a tab whose route is not built yet. */
export function Placeholder({ title }: { readonly title: string }) {
  return (
    <div className="flex h-[calc(100dvh-48px)] flex-col items-center justify-center gap-1 px-6">
      <h1 className="text-[16px] font-medium text-[var(--color-text)]">{title}</h1>
      <p className="text-[13px] text-[var(--color-text-muted)]">Coming soon.</p>
    </div>
  );
}
