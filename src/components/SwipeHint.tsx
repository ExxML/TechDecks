'use client';

import { useEffect, useState } from 'react';
import { ChevronLeft, Hand } from 'lucide-react';

/** How long a reader is left alone before being taught the gesture. */
const DELAY_MS = 5000;

type Props = {
  /** False once the reader has paged — the hint has been answered and must go. */
  readonly show: boolean;
};

/** The hint's own timer and fade. Mounted only while it is wanted, so `show`
 *  going false unmounts it rather than being synced into state by an effect. */
function Hint() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), DELAY_MS);
    return () => clearTimeout(timer);
  }, []);

  if (!visible) return null;

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-y-0 right-0 z-10 flex w-[45%] flex-col items-center justify-center gap-3"
      style={{
        animation: 'swipe-hint-in 400ms ease-out both',
        // Fades into the card rather than sitting on a panel: a bordered box
        // would read as a dismissible dialog, which this is not.
        background:
          'linear-gradient(to left, color-mix(in srgb, var(--color-bg) 92%, transparent), transparent)',
      }}
    >
      <div
        className="swipe-hint-hand flex items-center gap-1 text-[var(--color-accent)]"
        style={{ animation: 'swipe-hint-stroke 2200ms ease-in-out infinite' }}
      >
        <ChevronLeft size={20} strokeWidth={2.5} />
        <Hand size={32} strokeWidth={1.75} />
      </div>
      <p className="max-w-[140px] text-center text-[13px] leading-[1.4] text-[var(--color-text)]">
        Swipe here for the next problem
      </p>
    </div>
  );
}

/**
 * Teaches the one gesture the feed depends on: swipe sideways for the next
 * problem.
 *
 * Shown to signed-out readers only, and only while they are still on the card
 * the feed opened with — a reader who has paged once has already worked it out,
 * and a reader with an account has been here before. It appears after a pause
 * rather than immediately, so it reads as help for someone who has stalled
 * rather than as an interstitial in front of the first card.
 *
 * `pointer-events-none` throughout: the hint teaches a gesture, so it must
 * never be the thing that swallows it.
 */
export function SwipeHint({ show }: Props) {
  // Mount/unmount rather than a hidden flag: the first swipe removes the hint
  // and cancels a timer that has not yet fired, in the one gesture.
  return show ? <Hint /> : null;
}
