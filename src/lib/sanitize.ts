/**
 * HTML sanitization for untrusted problem bodies.
 *
 * Problem HTML comes from LeetCode and is untrusted. The plan requires
 * sanitizing at INGEST *and* at RENDER — two independent passes, because
 * ingest protects rows written from now on while render protects against
 * anything already in the table (including rows written before a sanitizer
 * bug was fixed, or hand-inserted test rows).
 *
 * This module is the single implementation both paths use. It is imported by
 * scripts/seed.ts (ingest, running under Node) and by the render path
 * (running in a browser or React Server Component), which is why the
 * dependency is `isomorphic-dompurify` rather than plain `dompurify`.
 */

import DOMPurify from 'isomorphic-dompurify';

/**
 * DOMPurify keeps an internal allow-list of tags for which `data:` URIs are
 * permitted regardless of ALLOWED_URI_REGEXP — `img` is on it, so
 * `<img src="data:text/html;base64,...">` survives the regexp alone. Some
 * browsers content-sniff that into a live document, so it is stripped here.
 *
 * Registered once at module load. `afterSanitizeAttributes` runs per element,
 * after DOMPurify has finished its own attribute filtering.
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

/**
 * Tags LeetCode actually uses in problem bodies. Anything not listed is
 * stripped. `<script>`, `<iframe>`, `<object>`, `<embed>`, `<form>`, and
 * event-handler attributes are all excluded by virtue of not being here.
 *
 * `sup`/`sub` matter for exponents (2^31), `code`/`pre` for inline samples,
 * and `img` for the diagram assets many problems embed.
 */
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
 * Sanitize untrusted problem HTML.
 *
 * `FORBID_TAGS`/`FORBID_ATTR` are redundant against the allow-list above and
 * are stated anyway: the allow-list is the mechanism, these are the assertion.
 * If someone widens ALLOWED_TAGS later, these still hold the line on the two
 * things that must never render.
 */
export function sanitizeProblemHtml(dirty: string | null | undefined): string | null {
  if (dirty === null || dirty === undefined) return null;
  installHook();

  const clean = DOMPurify.sanitize(dirty, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'link', 'meta'],
    FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'formaction'],
    // Only absolute http(s), mailto, protocol-relative, and relative URLs.
    //
    // This is deliberately stricter than DOMPurify's default expression, which
    // permits `data:` — and `data:text/html;base64,...` in an <img src> is a
    // real XSS vector in browsers that sniff it. LeetCode serves its diagrams
    // from assets.leetcode.com over https, so nothing legitimate needs `data:`.
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|\/\/|\/|\.{1,2}\/|#|[^a-z0-9+.-]|[a-z0-9+.-]+(?:[^a-z0-9+.:-]|$))/i,
    KEEP_CONTENT: true,
  });

  return clean;
}
