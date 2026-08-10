/**
 * Shared guard for global key handlers.
 *
 * Every shortcut in the app is a bare key with no modifier, which is what makes
 * this necessary: without it, typing "2" into the search box would jump the MCQ
 * strip, and typing in the problem editor would answer questions.
 */

/** True when the event originated somewhere the user is entering text. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;

  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.isContentEditable) return true;

  // A native <dialog> traps focus, and its controls are the user's current
  // context — a shortcut firing behind an open sheet would act on something
  // they cannot see.
  if (target.closest('dialog')) return true;

  return false;
}

/**
 * True when a shortcut should be ignored entirely.
 *
 * Modifier combinations belong to the browser and the OS: Ctrl+F, Cmd+R, and
 * Alt+Left must keep working, so a bare-key shortcut must never claim them.
 */
export function shouldIgnoreShortcut(e: KeyboardEvent): boolean {
  return e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target);
}
