/**
 * Node-side sanitizer, for ingest and the verification scripts.
 *
 * Separate from lib/sanitize so the `isomorphic-dompurify` import — and with it
 * jsdom — stays out of the Next.js module graph. Applies the same policy the
 * browser pass uses, so the two cannot drift.
 */

import DOMPurify from 'isomorphic-dompurify';
import { sanitizeWith } from './sanitize';

export function sanitizeProblemHtml(dirty: string | null | undefined): string | null {
  return sanitizeWith(DOMPurify, dirty);
}
