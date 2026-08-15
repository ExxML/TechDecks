'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * The paging engine behind the card feed and the MCQ strip, both of which page
 * horizontally.
 *
 * Native scroll-snap is deliberately not used. Its momentum belongs to the
 * browser and no two agree — a trackpad flick in Chrome crosses several snap
 * points before settling where iOS Safari settles on one, and neither exposes a
 * way to stop it. Driving the transform here makes one gesture mean exactly one
 * page on every input device.
 */

/** Commit when the release leaves more than half the next page showing. */
const COMMIT_RATIO = 0.5;
/** ...or when the finger was still moving this fast (px/ms) at release, so a
 *  deliberate flick commits without having to cross the halfway mark. */
const FLICK_VELOCITY = 0.3;
/** A flick must also travel this share of the page. Speed alone is not intent:
 *  a quick nudge while reading clears any velocity bar worth setting. */
const FLICK_MIN_RATIO = 0;
/** Velocity is measured over the tail of the gesture, not its whole length: a
 *  slow drag that ends in a flick should read as a flick. */
const VELOCITY_WINDOW_MS = 100;
/** Resistance past either end, so a blocked drag still moves a little. */
const EDGE_FRICTION = 0.3;
/** Wheel/trackpad delta that counts as one page. */
const WHEEL_THRESHOLD = 40;
/** A trackpad flick emits a long delta tail; it stays one gesture until this
 *  quiet gap, which is what stops one flick from crossing several pages. */
const WHEEL_IDLE_MS = 150;
/** Below this the gesture is still ambiguous, so neither axis claims it. */
const DIRECTION_SLOP = 8;

export type Axis = 'x' | 'y';

type Options = {
  readonly axis: Axis;
  readonly count: number;
  readonly index: number;
  readonly onIndexChange: (index: number) => void;
  /** Page extent in px — card width for the feed, panel width for the strip. */
  readonly pageSize: number;
  /** False while a sheet or dialog owns input. */
  readonly enabled?: boolean;
  /** Keep gestures from reaching an enclosing pager on the same axis. The MCQ
   *  strip sets this: inside the questions view, sideways means panel, not card. */
  readonly isolate?: boolean;
};

export type Pager = {
  /** Live offset in px, negative-forward: -index * pageSize plus any drag. */
  readonly offset: number;
  /** True while a claimed gesture is in progress, so the consumer can drop its
   *  transition and let the page track the finger. */
  readonly dragging: boolean;
  readonly goTo: (index: number) => void;
  /** Ref for the element that owns the gesture surface. */
  readonly ref: (node: HTMLElement | null) => void;
  readonly handlers: {
    readonly onPointerDown: (e: React.PointerEvent) => void;
    readonly onPointerMove: (e: React.PointerEvent) => void;
    readonly onPointerUp: (e: React.PointerEvent) => void;
    readonly onPointerCancel: (e: React.PointerEvent) => void;
  };
};

/** Mutable gesture state. A ref, not state: it changes on every pointermove and
 *  must never trigger a render of its own. */
type Drag = {
  readonly id: number;
  readonly startMain: number;
  readonly startCross: number;
  /** Where the pointer was on the previous move, for the release velocity. */
  lastPos: number;
  /** Recent (time, position) samples, trimmed to VELOCITY_WINDOW_MS. */
  readonly samples: Array<{ t: number; pos: number }>;
  /** Null until the gesture crosses DIRECTION_SLOP and an axis claims it. */
  claimed: boolean | null;
  delta: number;
};

export function usePager({
  axis,
  count,
  index,
  onIndexChange,
  pageSize,
  enabled = true,
  isolate = false,
}: Options): Pager {
  const [drag, setDrag] = useState(0);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<Drag | null>(null);
  const nodeRef = useRef<HTMLElement | null>(null);

  // Mirror of everything the pointer and wheel paths read. Both run from
  // listeners that must not be torn down and rebuilt on each index change, and
  // the pointer path reads it mid-gesture where a stale closure would commit
  // against the wrong page size.
  const live = useRef({ index, count, pageSize, enabled, onIndexChange });
  useEffect(() => {
    live.current = { index, count, pageSize, enabled, onIndexChange };
  });

  const goTo = useCallback((next: number) => {
    const { index: at, count: n, onIndexChange: emit } = live.current;
    const target = Math.max(0, Math.min(n - 1, next));
    if (target !== at) emit(target);
  }, []);

  const cancelDrag = useCallback(() => {
    dragRef.current = null;
    setDragging(false);
    setDrag(0);
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    // Claimed before any early return, so an enclosing pager on this axis never
    // sees the gesture even when this one declines it.
    if (isolate) e.stopPropagation();
    if (!live.current.enabled || dragRef.current) return;
    // A mouse drag is not a paging gesture: the wheel is the desktop input, and
    // paging on drag would make text unselectable in the description.
    if (e.pointerType === 'mouse') return;
    const pos = axis === 'y' ? e.clientY : e.clientX;
    dragRef.current = {
      id: e.pointerId,
      startMain: pos,
      startCross: axis === 'y' ? e.clientX : e.clientY,
      lastPos: pos,
      samples: [{ t: e.timeStamp, pos }],
      claimed: null,
      delta: 0,
    };
  }, [axis, isolate]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const active = dragRef.current;
    if (!active || active.id !== e.pointerId) return;

    const { index: at, count: n } = live.current;
    const pos = axis === 'y' ? e.clientY : e.clientX;
    const main = pos - active.startMain;
    const cross = (axis === 'y' ? e.clientX : e.clientY) - active.startCross;

    if (active.claimed === null) {
      if (Math.abs(main) < DIRECTION_SLOP && Math.abs(cross) < DIRECTION_SLOP) return;
      // A gesture across this axis belongs to whatever scrolls there — the
      // browser pans it natively — and once rejected it stays rejected for the
      // rest of the stroke.
      if (Math.abs(cross) > Math.abs(main)) {
        active.claimed = false;
        return;
      }
      active.claimed = true;
      setDragging(true);
      // Capture so a fast drag leaving the element still delivers its pointerup
      // here, rather than stranding the page mid-transition.
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    if (!active.claimed) return;

    active.lastPos = pos;
    active.samples.push({ t: e.timeStamp, pos });
    while (active.samples.length > 2 && e.timeStamp - active.samples[0].t > VELOCITY_WINDOW_MS) {
      active.samples.shift();
    }

    // At either end the page cannot move, so the drag is damped rather than
    // dropped — the rubber band is what says "nothing past here".
    const blocked = (main > 0 && at === 0) || (main < 0 && at === n - 1);
    active.delta = blocked ? main * EDGE_FRICTION : main;
    setDrag(active.delta);
  }, [axis]);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    const active = dragRef.current;
    if (!active || active.id !== e.pointerId) return;
    const { index: at, pageSize: size } = live.current;
    const { claimed, delta, samples } = active;
    cancelDrag();
    if (!claimed || delta === 0) return;

    // End time and end position both come from this event. Measuring the span
    // to the release but the distance only to the last move would charge the
    // gap between them — a whole sample interval — to the denominator alone,
    // under-reporting a flick by enough to make the threshold device-dependent.
    // The span still runs from the oldest sample, so a gesture held still
    // before release decays: the span keeps growing while the distance does not.
    // A cancel's coordinates are not trustworthy, so that path keeps the last
    // move instead.
    const first = samples[0];
    const pos = axis === 'y' ? e.clientY : e.clientX;
    const endPos = e.type === 'pointercancel' ? active.lastPos : pos;
    const span = first ? e.timeStamp - first.t : 0;
    const velocity = span > 0 ? (endPos - first.pos) / span : 0;

    // Distance OR velocity: past halfway commits, and so does a flick that
    // never got there, which is what a short fast swipe expects to do.
    // A flick only commits in the direction it was already travelling; a drag
    // reversed at the last moment must not throw the page the other way.
    const flicked =
      Math.abs(velocity) >= FLICK_VELOCITY &&
      Math.abs(delta) > size * FLICK_MIN_RATIO &&
      Math.sign(velocity) === Math.sign(delta);

    if (Math.abs(delta) > size * COMMIT_RATIO || flicked) {
      goTo(at + (delta < 0 ? 1 : -1));
    }
  }, [axis, cancelDrag, goTo]);

  /**
   * Wheel and trackpad.
   *
   * One continuous gesture is one page however many events it emits: the flick
   * latches on the first event past the threshold and stays latched until the
   * deltas stop for WHEEL_IDLE_MS. Without the latch a single two-finger flick
   * crosses three or four cards.
   *
   * Bound imperatively and non-passive because it must preventDefault; React's
   * onWheel is passive and cannot.
   */
  useEffect(() => {
    const node = nodeRef.current;
    if (!node) return;
    const wheel = { accum: 0, latched: false, timer: 0 };

    const onWheel = (e: WheelEvent) => {
      if (!live.current.enabled) return;
      const main = axis === 'y' ? e.deltaY : e.deltaX;
      const cross = axis === 'y' ? e.deltaX : e.deltaY;

      // A cross-axis wheel belongs to whatever scrolls there, which the browser
      // handles natively. The accumulator resets so delta spent reading a
      // description never counts toward a later page change.
      if (Math.abs(main) <= Math.abs(cross)) {
        wheel.accum = 0;
        return;
      }

      // An enclosing pager on this axis must not page as well. Claimed here
      // whether or not the accumulator has filled, so the deltas leading up to
      // a page change never leak outward either.
      if (isolate) e.stopPropagation();

      // This axis is driven here, so the browser must not scroll it as well.
      e.preventDefault();

      window.clearTimeout(wheel.timer);
      wheel.timer = window.setTimeout(() => {
        wheel.accum = 0;
        wheel.latched = false;
      }, WHEEL_IDLE_MS);

      if (wheel.latched) return;
      wheel.accum += main;
      if (Math.abs(wheel.accum) < WHEEL_THRESHOLD) return;
      wheel.latched = true;
      wheel.accum = 0;
      goTo(live.current.index + (main > 0 ? 1 : -1));
    };

    node.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      node.removeEventListener('wheel', onWheel);
      window.clearTimeout(wheel.timer);
    };
  }, [axis, goTo, isolate]);

  // A resize mid-drag would leave the offset measured against the old page
  // size, so the gesture is abandoned rather than corrected.
  useEffect(() => {
    if (!dragging) return;
    window.addEventListener('resize', cancelDrag);
    return () => window.removeEventListener('resize', cancelDrag);
  }, [dragging, cancelDrag]);

  const ref = useCallback((node: HTMLElement | null) => {
    nodeRef.current = node;
  }, []);

  const settled = Math.max(0, Math.min(count - 1, index));

  return {
    offset: -settled * pageSize + drag,
    dragging,
    goTo,
    ref,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
    },
  };
}
