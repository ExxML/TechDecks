/**
 * A small markdown subset renderer for authored problem bodies.
 *
 * Hand-built rather than a dependency, for the same reason the UI primitives
 * are: the supported surface is small and fully specified here, and its output
 * goes through the SAME DOMPurify pass as scraped LeetCode HTML. It is not a
 * CommonMark implementation and does not try to be — anything it does not
 * recognise renders as literal text rather than being silently dropped.
 *
 * Supported: ATX headings, fenced and indented-free code blocks, unordered and
 * ordered lists, blockquotes, horizontal rules, paragraphs, and the inline set
 * (code spans, bold, italic, links).
 *
 * SECURITY: every text run is HTML-escaped BEFORE any markup is emitted, so a
 * body containing `<script>` becomes visible text, never an element. Link
 * targets are additionally scheme-checked here; `sanitizeProblemHtml` is the
 * second, authoritative pass.
 */

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Only http(s), mailto, and relative targets survive. `javascript:` and `data:`
 * become plain text rather than a link — the sanitizer would strip the
 * attribute anyway, but a link with no href reads as broken.
 */
function safeHref(href: string): string | null {
  const trimmed = href.trim();
  if (/^(?:https?:\/\/|mailto:|\/|#)/i.test(trimmed)) return trimmed;
  return null;
}

/**
 * Inline markup, applied to already-escaped text.
 *
 * Code spans are extracted first and restored last, so `**` inside a code span
 * is never treated as emphasis.
 *
 * The placeholder is delimited by NUL, which cannot appear in the input:
 * `markdownToHtml` strips control characters before calling this. A plain-text
 * sentinel such as "CODE0" would collide with a body containing that literal.
 */
const CODE_SENTINEL = '\u0000';

function renderInline(escaped: string): string {
  const codeSpans: string[] = [];
  let out = escaped.replace(/`([^`]+)`/g, (_m, code: string) => {
    codeSpans.push(code);
    return `${CODE_SENTINEL}${codeSpans.length - 1}${CODE_SENTINEL}`;
  });

  // Links before emphasis: a bracketed label may itself contain emphasis.
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (match, label: string, href: string) => {
    const safe = safeHref(href);
    if (!safe) return match;
    return `<a href="${safe}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  });

  // Bold before italic, so `**x**` is not consumed as two italic runs.
  out = out
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/(^|[^_\w])_([^_\n]+)_/g, '$1<em>$2</em>');

  return out.replace(
    new RegExp(`${CODE_SENTINEL}(\\d+)${CODE_SENTINEL}`, 'g'),
    (_m, i: string) => `<code>${codeSpans[Number(i)]}</code>`,
  );
}

type ListState = { readonly tag: 'ul' | 'ol' } | null;

/**
 * Markdown source to HTML. The result still MUST pass through
 * `sanitizeProblemHtml` before rendering — this function escapes its input, but
 * the sanitizer is what the security guarantee rests on.
 */
export function markdownToHtml(src: string): string {
  const lines = src
    .replace(/\r\n?/g, '\n')
    // Strip control characters, tab excepted. This is what makes CODE_SENTINEL
    // safe: NUL cannot survive into renderInline's input, so it can never be
    // confused for a placeholder the author typed.
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .split('\n');
  const out: string[] = [];

  let list: ListState = null;
  let paragraph: string[] = [];
  let inFence = false;
  let fenceLang = '';
  let fenceBody: string[] = [];
  let quote: string[] = [];

  const closeList = () => {
    if (list) {
      out.push(`</${list.tag}>`);
      list = null;
    }
  };

  const closeParagraph = () => {
    if (paragraph.length > 0) {
      out.push(`<p>${renderInline(escapeHtml(paragraph.join('\n')))}</p>`);
      paragraph = [];
    }
  };

  const closeQuote = () => {
    if (quote.length > 0) {
      out.push(`<blockquote>${renderInline(escapeHtml(quote.join('\n')))}</blockquote>`);
      quote = [];
    }
  };

  const closeBlocks = () => {
    closeParagraph();
    closeQuote();
    closeList();
  };

  for (const line of lines) {
    // Inside a fence everything is literal, including what looks like markup.
    if (inFence) {
      if (/^\s*```/.test(line)) {
        const cls = fenceLang ? ` class="language-${escapeHtml(fenceLang)}"` : '';
        out.push(`<pre><code${cls}>${escapeHtml(fenceBody.join('\n'))}</code></pre>`);
        inFence = false;
        fenceLang = '';
        fenceBody = [];
      } else {
        fenceBody.push(line);
      }
      continue;
    }

    const fence = /^\s*```\s*([A-Za-z0-9_+-]*)\s*$/.exec(line);
    if (fence) {
      closeBlocks();
      inFence = true;
      fenceLang = fence[1] ?? '';
      continue;
    }

    if (/^\s*$/.test(line)) {
      closeBlocks();
      continue;
    }

    if (/^\s*(?:[-*_]\s*){3,}$/.test(line)) {
      closeBlocks();
      out.push('<hr />');
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      closeBlocks();
      const level = heading[1].length;
      out.push(`<h${level}>${renderInline(escapeHtml(heading[2].trim()))}</h${level}>`);
      continue;
    }

    const blockquote = /^\s*>\s?(.*)$/.exec(line);
    if (blockquote) {
      closeParagraph();
      closeList();
      quote.push(blockquote[1]);
      continue;
    }

    const unordered = /^\s*[-*+]\s+(.*)$/.exec(line);
    const ordered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (unordered || ordered) {
      closeParagraph();
      closeQuote();
      const tag: 'ul' | 'ol' = unordered ? 'ul' : 'ol';
      if (list && list.tag !== tag) closeList();
      if (!list) {
        out.push(`<${tag}>`);
        list = { tag };
      }
      const text = (unordered ?? ordered)![1];
      out.push(`<li>${renderInline(escapeHtml(text))}</li>`);
      continue;
    }

    // A non-blank line that matched nothing else continues the paragraph.
    closeQuote();
    closeList();
    paragraph.push(line);
  }

  // An unterminated fence still renders its content rather than swallowing it.
  if (inFence) {
    const cls = fenceLang ? ` class="language-${escapeHtml(fenceLang)}"` : '';
    out.push(`<pre><code${cls}>${escapeHtml(fenceBody.join('\n'))}</code></pre>`);
  }
  closeBlocks();

  return out.join('\n');
}
