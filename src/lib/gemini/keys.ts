/** Pure key/model helpers. Safe to import from both server and client code. */

/** `models/gemini-2.5-flash` -> `gemini-2.5-flash`. Bare IDs pass through. */
export function stripModelPrefix(model: string): string {
  return model.startsWith('models/') ? model.slice('models/'.length) : model;
}

/**
 * `.trim()` misses zero-width spaces, BOM, and directional marks, which a paste
 * routinely carries. Above U+00FF they also make `new Headers()` throw.
 */
export function normalizeApiKey(raw: string): string {
  return raw
    .replace(/[​-‍﻿⁠᠎]/g, '')
    .replace(/[‎‏‪-‮]/g, '')
    .trim();
}

/** Length only — Google issues several key formats, so never check a prefix. */
export function isPlausibleApiKey(key: string): boolean {
  return key.length >= 20;
}
