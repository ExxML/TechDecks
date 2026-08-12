/**
 * Which gestures belong to an inner scroller rather than to the pager.
 *
 * The pager drives its axis directly, so nothing chains: a gesture that starts
 * over a description scrolls it and only it, for as long as the finger is down.
 * Paging is reached from the parts of a card that do not scroll.
 */

/** Fractional layout heights never sum to exactly scrollHeight. */
const EDGE_SLACK = 1;

/** The nearest scroller on `axis` between `target` and the pager's root. */
export function innerScrollerOn(axis: 'x' | 'y' = 'y') {
  return (target: EventTarget | null, boundary: HTMLElement | null): HTMLElement | null => {
    let node = target instanceof HTMLElement ? target : null;

    while (node) {
      const style = getComputedStyle(node);
      const overflow = axis === 'y' ? style.overflowY : style.overflowX;
      if (overflow === 'auto' || overflow === 'scroll') {
        const extent =
          axis === 'y'
            ? node.scrollHeight - node.clientHeight
            : node.scrollWidth - node.clientWidth;
        // An element that does not actually overflow is not a scroller,
        // whatever its overflow value says.
        if (extent > EDGE_SLACK) return node;
      }
      if (node === boundary) break;
      node = node.parentElement;
    }

    return null;
  };
}
