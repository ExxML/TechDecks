/**
 * Stub for tabs whose real implementation lands in a later phase.
 *
 * The TabBar ships at P1 because without it there is no route to Settings, but
 * its destinations arrive at P2 (Settings), P4 (Bookmarks), and P5 (Search). A
 * tab that navigates nowhere reads as broken, so each says what it will be.
 * This is not onboarding copy — it is a stub label, and it is deleted as each
 * phase fills the route in.
 */
export function Placeholder({
  title,
  phase,
}: {
  readonly title: string;
  readonly phase: string;
}) {
  return (
    <div className="flex h-[calc(100dvh-48px)] flex-col items-center justify-center gap-1 px-6">
      <h1 className="text-[16px] font-medium text-[var(--color-text)]">{title}</h1>
      <p className="text-[13px] text-[var(--color-text-muted)]">Arrives in {phase}.</p>
    </div>
  );
}
