'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Drag-to-reorder for a vertical list of equal-height rows.
 *
 * The list never reflows mid-gesture. The dragged row is lifted out and follows
 * the pointer, and every row it has passed is translated one slot to fill the
 * gap it left — so the drop position is visible the whole time, and the rows
 * underneath cannot shuffle out from under the finger. Only the release
 * commits, which is what keeps one gesture to one reorder.
 *
 * Equal heights are assumed rather than measured: a row is one line of text, so
 * a slot is the height of the first row plus the list's gap.
 */

/** Below this the gesture is still a tap or a page scroll, so nothing lifts. */
const LIFT_SLOP = 6;

type Options = {
  readonly count: number;
  readonly onReorder: (from: number, to: number) => void;
};

export type Reorder = {
  /** The row being dragged, or null when idle. */
  readonly active: number | null;
  /** Where `active` would land on release. Equals `active` until it passes one. */
  readonly target: number | null;
  /** Live pointer offset in px for the lifted row. */
  readonly offset: number;
  /** Ref for the list element, which is measured for the slot height. */
  readonly ref: (node: HTMLElement | null) => void;
  /**
   * Spread onto every row's drag handle, which carries its own position as
   * `data-index`. One shared set of handlers rather than a set built per row,
   * so rendering a row never has to call into this hook.
   */
  readonly handleProps: {
    readonly onPointerDown: (e: React.PointerEvent) => void;
    readonly onPointerMove: (e: React.PointerEvent) => void;
    readonly onPointerUp: (e: React.PointerEvent) => void;
    readonly onPointerCancel: (e: React.PointerEvent) => void;
  };
  /**
   * Px to translate each row so it sits where the pending reorder would put it.
   * Zero for the lifted row, which follows `offset` instead, and all zero when
   * idle. One entry per row rather than a lookup function, so rendering a row
   * never has to call into this hook.
   */
  readonly shifts: readonly number[];
};

/** Mutable gesture state: it changes on every pointermove and must not render. */
type Drag = {
  readonly id: number;
  readonly from: number;
  readonly startY: number;
  /** Slot height in px, measured at lift so a resize cannot skew the maths. */
  readonly slot: number;
  lifted: boolean;
};

/** What the rows render from: null between gestures. */
type Lift = { readonly from: number; readonly slot: number };

export function useReorder({ count, onReorder }: Options): Reorder {
  const [lift, setLift] = useState<Lift | null>(null);
  const [offset, setOffset] = useState(0);
  const dragRef = useRef<Drag | null>(null);
  const nodeRef = useRef<HTMLElement | null>(null);

  // Read mid-gesture, where a stale closure would clamp against the wrong length.
  const live = useRef({ count, onReorder });
  useEffect(() => {
    live.current = { count, onReorder };
  });

  const end = useCallback(() => {
    dragRef.current = null;
    setLift(null);
    setOffset(0);
  }, []);

  /** Row height plus the gap to the next one — one slot of travel. */
  const measureSlot = () => {
    const rows = nodeRef.current?.children;
    if (!rows || rows.length === 0) return 0;
    const first = rows[0].getBoundingClientRect();
    if (rows.length < 2) return first.height;
    return rows[1].getBoundingClientRect().top - first.top;
  };

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    const attr = e.currentTarget.getAttribute('data-index');
    const index = attr === null ? NaN : Number(attr);
    if (dragRef.current || live.current.count < 2 || !Number.isInteger(index)) return;
    // The handle is the only grab surface, so the gesture is unambiguous and
    // the row's remove button stays clickable.
    e.preventDefault();
    const slot = measureSlot();
    if (slot === 0) return;
    dragRef.current = { id: e.pointerId, from: index, startY: e.clientY, slot, lifted: false };
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag || drag.id !== e.pointerId) return;
    const dy = e.clientY - drag.startY;

    if (!drag.lifted) {
      if (Math.abs(dy) < LIFT_SLOP) return;
      drag.lifted = true;
      setLift({ from: drag.from, slot: drag.slot });
      // Capture so a fast drag leaving the handle still delivers its pointerup
      // here, rather than stranding the row mid-lift.
      e.currentTarget.setPointerCapture(e.pointerId);
    }

    // Clamped to the list: past either end the row stops rather than floating
    // away from the slot it would drop into.
    const { count: n } = live.current;
    const min = -drag.from * drag.slot;
    const max = (n - 1 - drag.from) * drag.slot;
    setOffset(Math.max(min, Math.min(max, dy)));
  }, []);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag || drag.id !== e.pointerId) return;
    const { from, slot, lifted } = drag;
    const to = lifted ? targetIndex(from, offset, slot, live.current.count) : from;
    end();
    if (to !== from) live.current.onReorder(from, to);
  }, [offset, end]);

  const ref = useCallback((node: HTMLElement | null) => {
    nodeRef.current = node;
  }, []);

  const active = lift?.from ?? null;
  const target = lift ? targetIndex(lift.from, offset, lift.slot, count) : null;

  // Only the rows between the lifted row's origin and its target move, each by
  // one slot, toward the gap the lift left behind.
  const shifts = Array.from({ length: count }, (_, index) => {
    if (!lift || target === null || index === lift.from) return 0;
    if (lift.from < target && index > lift.from && index <= target) return -lift.slot;
    if (lift.from > target && index >= target && index < lift.from) return lift.slot;
    return 0;
  });

  return {
    active,
    target,
    offset,
    ref,
    handleProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
    },
    shifts,
  };
}

/** The slot a row dragged `offset` px from `from` currently sits over. */
function targetIndex(from: number, offset: number, slot: number, count: number): number {
  if (slot === 0) return from;
  return Math.max(0, Math.min(count - 1, from + Math.round(offset / slot)));
}
