import { sanitizeProblemHtml } from '@/lib/sanitize';

/**
 * Renders untrusted problem HTML.
 *
 * Sanitizes AGAIN at render, even though the seed sanitized at ingest. The two
 * passes protect different things: ingest covers rows written from now on,
 * render covers whatever is already in the table — rows written before a
 * sanitizer fix, or hand-inserted test rows. `dangerouslySetInnerHTML` is only
 * acceptable here because of that second pass.
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
