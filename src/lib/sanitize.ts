/**
 * Sanitization policy for untrusted problem HTML, applied at ingest AND at
 * render: ingest covers what the sync writes, render covers whatever is already
 * in the table.
 *
 * Callers pass their own DOMPurify instance — `sanitizeNode` under Node,
 * `dompurify` in the browser. This module must never import either one:
 * `isomorphic-dompurify` pulls in jsdom, whose html-encoding-sniffer require()s
 * an ESM-only module and throws ERR_REQUIRE_ESM in Vercel's bundled runtime.
 * A local node_modules tree resolves it, so that breaks only once deployed.
 */

/**
 * The DOMPurify surface used here, declared structurally so neither package's
 * types are imported. `addHook`'s real signature is a union of overloads keyed
 * on hook name; only 'afterSanitizeAttributes' is used.
 */
type PurifyLike = {
  sanitize: (dirty: string, config: SanitizeConfig) => string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  addHook: (entryPoint: any, cb: any) => void;
};

/** Mutable arrays: DOMPurify's Config rejects readonly ones. */
type SanitizeConfig = {
  ALLOWED_TAGS: string[];
  ALLOWED_ATTR: string[];
  FORBID_TAGS: string[];
  FORBID_ATTR: string[];
  ALLOWED_URI_REGEXP: RegExp;
  KEEP_CONTENT: boolean;
};

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
 * Shared by both passes, so ingest and render cannot enforce different rules.
 *
 * `FORBID_TAGS`/`FORBID_ATTR` are redundant against the allow-list, and hold
 * the line anyway if ALLOWED_TAGS is ever widened.
 */
export const SANITIZE_CONFIG: SanitizeConfig = {
  ALLOWED_TAGS,
  ALLOWED_ATTR,
  FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'link', 'meta'],
  FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'formaction'],
  // http(s), mailto, protocol-relative, and relative only. Stricter than
  // DOMPurify's default, which permits `data:`.
  ALLOWED_URI_REGEXP:
    /^(?:https?:|mailto:|\/\/|\/|\.{1,2}\/|#|[^a-z0-9+.-]|[a-z0-9+.-]+(?:[^a-z0-9+.:-]|$))/i,
  KEEP_CONTENT: true,
};

/**
 * DOMPurify permits `data:` on `img` regardless of ALLOWED_URI_REGEXP, and some
 * browsers content-sniff `data:text/html` into a live document.
 *
 * Idempotent per instance: the hook is registered once, tracked by a WeakSet so
 * two instances cannot share a flag.
 */
const hooked = new WeakSet<PurifyLike>();

export function stripDataUris(purify: PurifyLike): void {
  if (hooked.has(purify)) return;
  hooked.add(purify);
  purify.addHook('afterSanitizeAttributes', (node: unknown) => {
    const el = node as Element;
    if (typeof el?.getAttribute !== 'function') return;
    for (const attr of ['src', 'href', 'xlink:href'] as const) {
      const value = el.getAttribute(attr);
      if (value && /^\s*data:/i.test(value)) el.removeAttribute(attr);
    }
  });
}

/** Apply the shared policy with a caller-supplied DOMPurify instance. */
export function sanitizeWith(
  purify: PurifyLike,
  dirty: string | null | undefined,
): string | null {
  if (dirty === null || dirty === undefined) return null;
  stripDataUris(purify);
  return purify.sanitize(dirty, SANITIZE_CONFIG);
}
