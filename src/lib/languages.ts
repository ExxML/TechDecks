/**
 * The languages LeetCode officially offers, keyed by the `langSlug` its API
 * returns in `codeSnippets`.
 *
 * One list, used by Settings' default-language picker and by anything that has
 * to name a slug the catalog uses. A problem's OWN selectable languages still
 * come from its codeSnippets — only those have a real signature to pin against
 * — so the Generate sheet reads this only for display names.
 */

export const LANGUAGES = [
  { slug: 'cpp', name: 'C++' },
  { slug: 'java', name: 'Java' },
  { slug: 'python', name: 'Python' },
  { slug: 'python3', name: 'Python3' },
  { slug: 'c', name: 'C' },
  { slug: 'csharp', name: 'C#' },
  { slug: 'javascript', name: 'JavaScript' },
  { slug: 'typescript', name: 'TypeScript' },
  { slug: 'php', name: 'PHP' },
  { slug: 'swift', name: 'Swift' },
  { slug: 'kotlin', name: 'Kotlin' },
  { slug: 'dart', name: 'Dart' },
  { slug: 'golang', name: 'Go' },
  { slug: 'ruby', name: 'Ruby' },
  { slug: 'scala', name: 'Scala' },
  { slug: 'rust', name: 'Rust' },
  { slug: 'racket', name: 'Racket' },
  { slug: 'erlang', name: 'Erlang' },
  { slug: 'elixir', name: 'Elixir' },
] as const;

export type LanguageSlug = (typeof LANGUAGES)[number]['slug'];

/** The slug assumed wherever a problem offers it and the user has no preference. */
export const DEFAULT_LANGUAGE: LanguageSlug = 'python3';

const NAMES = new Map<string, string>(LANGUAGES.map((l) => [l.slug, l.name]));

/** Display name for a slug, falling back to the slug itself for anything the
 *  catalog carries that this list does not. */
export function languageName(slug: string): string {
  return NAMES.get(slug) ?? slug;
}
