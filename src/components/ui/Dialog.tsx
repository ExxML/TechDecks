'use client';

import { useEffect, useRef, type PointerEvent, type ReactNode } from 'react';
import { X } from 'lucide-react';

type Props = {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly title: string;
  readonly children: ReactNode;
};

const stopPointer = (e: PointerEvent) => e.stopPropagation();

/**
 * Bottom sheet on mobile, centred panel above. Built on <dialog> for native
 * focus trapping, Escape handling, and top-layer stacking.
 */
export function Dialog({ open, onClose, title, children }: Props) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    else if (!open && el.open) el.close();
  }, [open]);

  // Escape fires `cancel`, not `close`; route both through onClose so the
  // parent's state cannot drift from the element's actual open state.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const handle = (e: Event) => {
      e.preventDefault();
      onClose();
    };
    el.addEventListener('cancel', handle);
    return () => el.removeEventListener('cancel', handle);
  }, [onClose]);

  // The dialog sits in the top layer but stays in the DOM under whatever opened
  // it, so its wheel would otherwise reach the pagers there and page the feed.
  // The pager binds wheel natively to preventDefault, so this must be native
  // too. Pointer events are stopped on the JSX below instead: a native listener
  // here runs before React's root delegation and would swallow them for the
  // dialog's own contents as well.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const stop = (e: Event) => e.stopPropagation();
    el.addEventListener('wheel', stop);
    return () => el.removeEventListener('wheel', stop);
  }, []);

  return (
    <dialog
      ref={ref}
      // Nothing inside a modal belongs to anything behind it. Stopped at the
      // React layer, which is where the pagers listen.
      onPointerDown={stopPointer}
      onPointerMove={stopPointer}
      onPointerUp={stopPointer}
      onPointerCancel={stopPointer}
      onClick={(e) => {
        // Backdrop click: the target is the dialog itself only when the click
        // landed outside the content box.
        if (e.target === ref.current) onClose();
      }}
      className={
        'w-full max-w-[420px] rounded-[8px] border border-[var(--color-border)] ' +
        'bg-[var(--color-surface)] p-0 text-[var(--color-text)] backdrop:bg-black/60 ' +
        'm-0 mt-auto max-h-[85dvh] flex-col open:flex sm:m-auto'
      }
    >
      <div className="flex shrink-0 items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
        <h2 className="text-[16px] font-medium">{title}</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="text-[var(--color-text-muted)] transition-colors duration-100 hover:text-[var(--color-text)]"
        >
          <X size={16} />
        </button>
      </div>
      {/* Opts back in to vertical panning, which the pager surface underneath
          turns off for the whole subtree. */}
      <div className="min-h-0 overflow-y-auto px-4 py-4" style={{ touchAction: 'pan-y' }}>
        {children}
      </div>
    </dialog>
  );
}
