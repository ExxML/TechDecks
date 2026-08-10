import { sanitizeProblemHtml } from '@/lib/sanitize';

/**
 * Sanitizes again at render, covering rows the ingest pass never saw.
 * `dangerouslySetInnerHTML` is only acceptable because of it.
 */
export function ProblemBody({ html }: { readonly html: string | null }) {
  if (!html) {
    return (
      <p className="text-[14px] text-[var(--color-text-muted)]">
        This problem&rsquo;s description isn&rsquo;t available.
      </p>
    );
  }

  const clean = sanitizeProblemHtml(html);
  if (!clean) return null;

  return <div className="problem-body" dangerouslySetInnerHTML={{ __html: clean }} />;
}
