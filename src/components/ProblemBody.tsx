import { sanitizeProblemHtml } from '@/lib/sanitize';
import { markdownToHtml } from '@/lib/markdown';

type Props = {
  readonly html: string | null;
  /** Authored problems store markdown; synced problems store HTML. */
  readonly format?: 'html' | 'markdown';
};

/**
 * Sanitizes again at render, covering rows the ingest pass never saw.
 * `dangerouslySetInnerHTML` is only acceptable because of it.
 *
 * Markdown bodies are converted first, then sanitized by the SAME pass — the
 * renderer escapes its input, but the sanitizer is what the guarantee rests on.
 */
export function ProblemBody({ html, format = 'html' }: Props) {
  if (!html) {
    return (
      <p className="text-[14px] text-[var(--color-text-muted)]">
        This problem&rsquo;s description isn&rsquo;t available.
      </p>
    );
  }

  const source = format === 'markdown' ? markdownToHtml(html) : html;
  const clean = sanitizeProblemHtml(source);
  if (!clean) return null;

  return <div className="problem-body" dangerouslySetInnerHTML={{ __html: clean }} />;
}
