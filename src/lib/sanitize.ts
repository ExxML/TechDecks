/**
 * Sanitization for untrusted problem HTML, applied at ingest AND at render.
 *
 * Two passes because they cover different rows: ingest covers what the seed
 * writes, render covers whatever is already in the table. Both run under Node
 * and in the browser, hence `isomorphic-dompurify`.
 */

import DOMPurify from 'isomorphic-dompurify';

/**
 * DOMPurify permits `data:` on `img` regardless of ALLOWED_URI_REGEXP, and some
 * browsers content-sniff `data:text/html` into a live document.
 */
let hookInstalled = false;
function installHook(): void {
  if (hookInstalled) return;
  hookInstalled = true;
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    for (const attr of ['src', 'href', 'xlink:href'] as const) {
      const el = node as Element;
      if (typeof el.getAttribute !== 'function') continue;
      const value = el.getAttribute(attr);
      if (value && /^\s*data:/i.test(value)) el.removeAttribute(attr);
    }
  });
}

/** Tags LeetCode uses in problem bodies. Anything absent is stripped. */
const ALLOWED_TAGS = [
  'p', 'br', 'hr', 'div', 'span',
  'strong', 'b', 'em', 'i', 'u', 's', 'small',
  'sup', 'sub',
  'code', 'pre', 'kbd', 'samp', 'var',
  'ul', 'ol', 'li', 'dl', 'dt', 'dd',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'blockquote', 'figure', 'figcaption',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
  'a', 'img',
  'font',
];

const ALLOWED_ATTR = [
  'href', 'target', 'rel',
  'src', 'alt', 'width', 'height',
  'colspan', 'rowspan',
  'class', 'style',
  'title',
];

/**
 * `FORBID_TAGS`/`FORBID_ATTR` are redundant against the allow-list, and hold
 * the line anyway if ALLOWED_TAGS is ever widened.
 */
export function sanitizeProblemHtml(dirty: string | null | undefined): string | null {
  if (dirty === null || dirty === undefined) return null;
  installHook();

  const clean = DOMPurify.sanitize(dirty, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'link', 'meta'],
    FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'formaction'],
    // http(s), mailto, protocol-relative, and relative only. Stricter than
    // DOMPurify's default, which permits `data:`.
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|\/\/|\/|\.{1,2}\/|#|[^a-z0-9+.-]|[a-z0-9+.-]+(?:[^a-z0-9+.:-]|$))/i,
    KEEP_CONTENT: true,
  });

  return clean;
}
