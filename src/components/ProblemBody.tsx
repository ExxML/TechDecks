'use client';

import { useSyncExternalStore } from 'react';
import DOMPurify from 'dompurify';
import { SANITIZE_CONFIG, stripDataUris } from '@/lib/sanitize';
import { markdownToHtml } from '@/lib/markdown';

type Props = {
  readonly html: string | null;
  /** Authored problems store markdown; synced problems store HTML. */
  readonly format?: 'html' | 'markdown';
};

/** True once rendering on the client, without an effect writing state. */
const emptySubscribe = () => () => {};
const useIsClient = () => useSyncExternalStore(emptySubscribe, () => true, () => false);

/**
 * Renders the problem description, sanitized in the browser against the real
 * DOM — the only place this HTML could do harm, and this runs first.
 *
 * Imports `dompurify` directly, never the isomorphic wrapper: that would pull
 * jsdom into the server pass, which throws ERR_REQUIRE_ESM in Vercel's runtime
 * even though this code only executes on the client. Ingest is sanitized
 * separately in scripts/lib/sync.ts, under Node.
 */
export function ProblemBody({ html, format = 'html' }: Props) {
  const isClient = useIsClient();

  if (!html) {
    return (
      <p className="text-[14px] text-[var(--color-text-muted)]">
        This problem&rsquo;s description isn&rsquo;t available.
      </p>
    );
  }

  // Server and hydration passes render the same empty box, so the trees match.
  // Never emits raw HTML: without JS the body stays empty rather than unsanitized.
  if (!isClient) {
    return <div className="problem-body" aria-busy="true" />;
  }

  const source = format === 'markdown' ? markdownToHtml(html) : html;
  stripDataUris(DOMPurify);
  const clean = DOMPurify.sanitize(source, SANITIZE_CONFIG);

  return <div className="problem-body" dangerouslySetInnerHTML={{ __html: clean }} />;
}
