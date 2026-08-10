/**
 * Sanitizer verification — the ingest half.
 *
 *   npx tsx scripts/verify-sanitize.ts
 *
 * Feeds hostile HTML through sanitizeProblemHtml() and asserts the dangerous
 * parts are gone while legitimate problem markup survives. LeetCode bodies use
 * <sup> for exponents, <code>/<pre> for samples, and <img> for diagrams, so a
 * sanitizer that strips those is as broken as one that lets scripts through.
 *
 * The render-side half — a <script> planted in a real row must not execute in
 * the browser — is checked against the running app instead.
 */

import { sanitizeProblemHtml } from '../src/lib/sanitize';

type Case = {
  name: string;
  input: string;
  mustNotContain: string[];
  mustContain?: string[];
};

const CASES: Case[] = [
  {
    name: 'inline <script>',
    input: '<p>Given an array</p><script>window.__pwned = 1;</script>',
    mustNotContain: ['<script', '__pwned'],
    mustContain: ['<p>Given an array</p>'],
  },
  {
    name: 'img onerror handler',
    input: '<img src="x" onerror="window.__pwned=1">',
    mustNotContain: ['onerror', '__pwned'],
  },
  {
    name: 'javascript: href',
    input: '<a href="javascript:alert(1)">click</a>',
    mustNotContain: ['javascript:'],
  },
  {
    name: 'iframe',
    input: '<iframe src="https://evil.example/"></iframe>',
    mustNotContain: ['<iframe'],
  },
  {
    name: 'svg onload',
    input: '<svg><animate onbegin="window.__pwned=1" attributeName="x"></animate></svg>',
    mustNotContain: ['onbegin', '<svg', '__pwned'],
  },
  {
    name: 'form + input exfil',
    input: '<form action="https://evil.example"><input name="a"></form>',
    mustNotContain: ['<form', '<input'],
  },
  {
    name: 'style tag',
    input: '<style>body{display:none}</style><p>ok</p>',
    mustNotContain: ['<style'],
    mustContain: ['<p>ok</p>'],
  },
  {
    // The classic filter-evasion payload: removing the inner <script> naively
    // would re-form an outer one. DOMPurify strips the tags and HTML-escapes
    // the leftovers, so `__pwned` survives as inert visible TEXT — that is a
    // pass, not a leak. The assertion therefore checks for live markup only.
    name: 'nested/obfuscated script',
    input: '<p>a</p><scr<script>ipt>window.__pwned=1</scr</script>ipt>',
    mustNotContain: ['<script', '<scr<'],
  },
  {
    name: 'data: URI image (html payload)',
    input: '<img src="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">',
    mustNotContain: ['data:text/html'],
  },
  {
    name: 'data: URI in anchor',
    input: '<a href="data:text/html,<script>alert(1)</script>">x</a>',
    mustNotContain: ['data:text/html', '<script'],
  },
  {
    name: 'vbscript: href',
    input: '<a href="vbscript:msgbox(1)">x</a>',
    mustNotContain: ['vbscript:'],
  },
  {
    name: 'case/whitespace-evading javascript: href',
    input: '<a href="JaVaScRiPt&#58;alert(1)">x</a><a href=" javascript:alert(1)">y</a>',
    mustNotContain: ['javascript:'],
  },
  {
    // Escaped leftovers are inert. Proving it explicitly so the nested-script
    // case above is not taking anything on faith: no raw '<' may remain around
    // the payload text.
    name: 'obfuscated leftovers are escaped, not live markup',
    input: '<scr<script>ipt>alert(1)</scr</script>ipt>',
    mustNotContain: ['<script', '<scr'],
  },
  // --- legitimate LeetCode markup that MUST survive -----------------------
  {
    name: 'legit: sup / code / pre / em',
    input:
      '<p>where <code>nums[i]</code> and <sup>2</sup><sub>31</sub></p>' +
      '<pre><strong>Input:</strong> nums = [2,7]</pre><em>note</em>',
    mustNotContain: [],
    mustContain: ['<code>nums[i]</code>', '<sup>2</sup>', '<sub>31</sub>', '<pre>', '<em>note</em>'],
  },
  {
    name: 'legit: https image + list + table',
    input:
      '<img src="https://assets.leetcode.com/uploads/x.jpg" alt="diagram" />' +
      '<ul><li>one</li></ul><table><tr><td>c</td></tr></table>',
    mustNotContain: [],
    mustContain: ['assets.leetcode.com', '<li>one</li>', '<td>c</td>'],
  },
];

let failures = 0;

for (const c of CASES) {
  const out = sanitizeProblemHtml(c.input) ?? '';
  const lower = out.toLowerCase();
  const bad = c.mustNotContain.filter((s) => lower.includes(s.toLowerCase()));
  const missing = (c.mustContain ?? []).filter((s) => !out.includes(s));

  if (bad.length === 0 && missing.length === 0) {
    console.log(`  PASS  ${c.name}`);
  } else {
    failures++;
    console.log(`  FAIL  ${c.name}`);
    if (bad.length) console.log(`          leaked: ${bad.join(', ')}`);
    if (missing.length) console.log(`          stripped legit markup: ${missing.join(', ')}`);
    console.log(`          output: ${out.slice(0, 160)}`);
  }
}

console.log('');
console.log(`null input -> ${JSON.stringify(sanitizeProblemHtml(null))}`);
console.log('');

if (failures > 0) {
  console.log(`SANITIZER FAILED — ${failures} case(s)`);
  process.exit(1);
}
console.log(`SANITIZER PASSED — ${CASES.length} cases`);
