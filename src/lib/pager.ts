'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * The paging engine behind both feed axes: vertical cards and the horizontal
 * MCQ strip.
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
 *  short flick commits without having to cross the halfway mark. */
const FLICK_VELOCITY = 0.5;
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
/** Momentum decay per frame for a flung inner scroller, at 60fps. Touch
 *  scrolling is driven here, so the coast after release is ours to supply. */
const MOMENTUM_DECAY = 0.95;
/** Below this speed (px/ms) the coast is over; running it to zero wastes
 *  frames on movement too small to see. */
const MOMENTUM_MIN_VELOCITY = 0.02;
/** Ceiling on release speed. A thumb tops out near 4 px/ms; anything above is
 *  a synthetic or coalesced event, and would fling the whole description. */
const MOMENTUM_MAX_VELOCITY = 4;

export type Axis = 'x' | 'y';

/**
 * Finds the scroller, if any, that a gesture starting at `target` should drive
 * before the pager does. `boundary` is the pager's own root, where the search
 * stops.
 */
export type InnerScrollerLookup = (
  target: EventTarget | null,
  boundary: HTMLElement | null,
) => HTMLElement | null;

type Options = {
  readonly axis: Axis;
  readonly count: number;
  readonly index: number;
  readonly onIndexChange: (index: number) => void;
  /** Page extent in px — card height for the feed, panel width for the strip. */
  readonly pageSize: number;
  /** False while a sheet or dialog owns input. */
  readonly enabled?: boolean;
  readonly innerScroller?: InnerScrollerLookup;
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
  /** Where the pointer was on the previous move, for the incremental scroll. */
  lastPos: number;
  /** Recent (time, position) samples, trimmed to VELOCITY_WINDOW_MS. */
  readonly samples: Array<{ t: number; pos: number }>;
  /** The scroller this gesture drives instead of the pager, resolved once. */
  inner: HTMLElement | null;
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
  innerScroller,
}: Options): Pager {
  const [drag, setDrag] = useState(0);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<Drag | null>(null);
  const nodeRef = useRef<HTMLElement | null>(null);

  // Mirror of everything the pointer and wheel paths read. Both run from
  // listeners that must not be torn down and rebuilt on each index change, and
  // the pointer path reads it mid-gesture where a stale closure would commit
  // against the wrong page size.
  const live = useRef({ index, count, pageSize, enabled, onIndexChange, innerScroller });
  useEffect(() => {
    live.current = { index, count, pageSize, enabled, onIndexChange, innerScroller };
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

  // Momentum for an inner scroller after the finger lifts. The browser would
  // normally supply this, but touch scrolling is driven from here, so the coast
  // is ours to animate too.
  const momentumRef = useRef(0);

  const stopMomentum = useCallback(() => {
    cancelAnimationFrame(momentumRef.current);
    momentumRef.current = 0;
  }, []);

  const flingInner = useCallback((el: HTMLElement, velocity: number, axis: Axis) => {
    const prop = axis === 'y' ? 'scrollTop' : 'scrollLeft';
    const extent =
      axis === 'y' ? el.scrollHeight - el.clientHeight : el.scrollWidth - el.clientWidth;
    // Velocity is px/ms toward the finger; the content moves the other way.
    let v = -Math.sign(velocity) * Math.min(Math.abs(velocity), MOMENTUM_MAX_VELOCITY);
    let last = 0;

    const step = (now: number) => {
      // First frame establishes the clock rather than integrating against 0.
      const dt = last ? now - last : 16;
      last = now;
      const before = el[prop];
      el[prop] = Math.max(0, Math.min(extent, before + v * dt));
      // Decay is per 60fps frame, so a slow frame decays proportionally more.
      v *= Math.pow(MOMENTUM_DECAY, dt / 16);
      // Stop at the ends: coasting into a wall should not keep burning frames.
      if (Math.abs(v) < MOMENTUM_MIN_VELOCITY || el[prop] === before) {
        momentumRef.current = 0;
        return;
      }
      momentumRef.current = requestAnimationFrame(step);
    };

    momentumRef.current = requestAnimationFrame(step);
  }, []);

  useEffect(() => stopMomentum, [stopMomentum]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (!live.current.enabled || dragRef.current) return;
    // Touching a coasting scroller catches it, as it would natively.
    stopMomentum();
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
      inner: null,
      claimed: null,
      delta: 0,
    };
  }, [axis, stopMomentum]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const active = dragRef.current;
    if (!active || active.id !== e.pointerId) return;

    const { index: at, count: n } = live.current;
    const pos = axis === 'y' ? e.clientY : e.clientX;
    const main = pos - active.startMain;
    const cross = (axis === 'y' ? e.clientX : e.clientY) - active.startCross;

    if (active.claimed === null) {
      if (Math.abs(main) < DIRECTION_SLOP && Math.abs(cross) < DIRECTION_SLOP) return;
      // A mostly-perpendicular gesture never becomes a page change, and once
      // rejected on that basis it stays rejected for the rest of the gesture.
      if (Math.abs(cross) > Math.abs(main)) {
        active.claimed = false;
        return;
      }
      // A gesture that starts over a scroller belongs to it for its whole
      // length, whether or not it reaches an end: paging from there would
      // move the card out from under someone who is still reading.
      active.inner = live.current.innerScroller?.(e.target, nodeRef.current) ?? null;
      active.claimed = true;
      setDragging(!active.inner);
      // Capture so a fast drag leaving the element still delivers its pointerup
      // here, rather than stranding the page mid-transition.
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    if (!active.claimed) return;

    const prev = active.lastPos;
    active.lastPos = pos;
    active.samples.push({ t: e.timeStamp, pos });
    while (active.samples.length > 2 && e.timeStamp - active.samples[0].t > VELOCITY_WINDOW_MS) {
      active.samples.shift();
    }

    // The scroller is driven from here rather than by the browser, which would
    // otherwise claim the pointer and cancel it on the first native pan.
    if (active.inner) {
      active.inner[axis === 'y' ? 'scrollTop' : 'scrollLeft'] -= pos - prev;
      return;
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
    const { claimed, delta, samples, inner } = active;
    cancelDrag();
    if (!claimed) return;

    const first = samples[0];
    const span = first ? e.timeStamp - first.t : 0;
    const velocity = span > 0 ? (active.lastPos - first.pos) / span : 0;

    // A scroller keeps its own gesture, so releasing over one coasts it rather
    // than paging.
    if (inner) {
      if (Math.abs(velocity) >= MOMENTUM_MIN_VELOCITY) flingInner(inner, velocity, axis);
      return;
    }
    if (delta === 0) return;

    // Distance OR velocity: past halfway commits, and so does a flick that
    // never got there, which is what a short fast swipe expects to do.
    // A flick only commits in the direction it was already travelling; a drag
    // reversed at the last moment must not throw the page the other way.
    const flicked = Math.abs(velocity) >= FLICK_VELOCITY && Math.sign(velocity) === Math.sign(delta);

    if (Math.abs(delta) > size * COMMIT_RATIO || flicked) {
      goTo(at + (delta < 0 ? 1 : -1));
    }
  }, [axis, cancelDrag, flingInner, goTo]);

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
      if (Math.abs(main) <= Math.abs(cross)) return;

      // A wheel over a scroller is that scroller's, at its ends as much as in
      // the middle; the browser scrolls it natively. The accumulator resets
      // so delta spent reading never counts toward a later page change.
      if (live.current.innerScroller?.(e.target, node)) {
        wheel.accum = 0;
        return;
      }

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
  }, [axis, goTo]);

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
