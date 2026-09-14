/**
 * A refresh on a problem deals a new one.
 *
 * The feed rewrites the URL to `/problems/[slug]` as it pages, so the address
 * a reader reloads is whatever card they happened to stop on — and reloading
 * it would anchor the next deck at that same card. A refresh is the gesture
 * that asks for a new problem, so it is sent to `/problems`, which deals one.
 *
 * Only a reload. A deep link followed for the first time — shared, bookmarked,
 * opened from a result list — still opens on the problem it names; it is
 * `navigate`, not `reload`, in the Navigation Timing entry. A reload is not
 * distinguishable server-side: the `Cache-Control: max-age=0` that Chrome
 * sends is neither universal nor exclusive to reloads.
 *
 * Runs in <head> before first paint, and `replace` keeps the reloaded entry out
 * of history, so neither the anchored card nor an extra back step is ever seen.
 *
 * Written as a function rather than a string so the compiler and linter parse
 * it: source that only ever exists as a string is never checked, and a syntax
 * error in it fails silently — the browser drops the script and the page simply
 * behaves as though it were not there. Hence also no regex literal, whose
 * escapes have to survive being serialised. See feedSession.ts for the other
 * half of this: sessions are module state precisely so a refresh clears them.
 */
function reshuffleOnReload(): void {
  try {
    const entry = performance.getEntriesByType('navigation')[0] as
      | PerformanceNavigationTiming
      | undefined;
    // Not `startsWith('/problems')` — that would also match /problems itself,
    // which already deals a fresh shuffle and must not bounce to itself.
    if (entry?.type === 'reload' && location.pathname.startsWith('/problems/')) {
      location.replace('/problems');
    }
  } catch {
    // Navigation Timing unavailable; the reloaded card stands.
  }
}

/** The checked function above, as the inline <head> script that runs it. */
export const RESHUFFLE_INIT_SCRIPT = `(${reshuffleOnReload.toString()})()`;
