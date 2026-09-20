"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ChevronUp } from "lucide-react";

/**
 * Text field with a grouped suggestion list. Free text is the primary input and
 * a suggestion is a shortcut to it, so what is typed is never overwritten by
 * what is highlighted — only a commit writes a value.
 *
 * Hand-rolled rather than <input list> + <datalist>, which cannot group its
 * options, and rather than a <select>, which cannot accept free text.
 */

export type ComboboxGroup = {
  readonly label: string;
  readonly options: readonly {
    readonly value: string;
    readonly label: string;
  }[];
};

type Props = {
  readonly value: string;
  readonly onChange: (value: string) => void;
  /** A typed entry or a picked suggestion, both of which clear the field. */
  readonly onCommit: (value: string) => void;
  readonly groups: readonly ComboboxGroup[];
  readonly placeholder?: string;
  readonly maxLength?: number;
  readonly "aria-label": string;
};

export function Combobox({
  value,
  onChange,
  onCommit,
  groups,
  placeholder,
  maxLength,
  "aria-label": ariaLabel,
}: Props) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const options = groups.flatMap((g) => g.options);
  const active = open && options.length > 0;
  /** Where each group's options start in `options`. */
  const offsets = groups.reduce<number[]>(
    (acc, g, i) => [...acc, acc[i] + g.options.length],
    [0],
  );

  // Pointerdown, not click: a mousedown outside must dismiss the list before
  // that press lands, so the field does not steal it.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const commit = (raw: string) => {
    onCommit(raw);
    setOpen(false);
    setHighlight(-1);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setOpen(false);
      setHighlight(-1);
      return;
    }
    if (e.key === "Enter") {
      // Enter must not submit the surrounding form — it commits a kind.
      e.preventDefault();
      commit(active && highlight >= 0 ? options[highlight].value : value);
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    if (!open) {
      setOpen(true);
      return;
    }
    if (options.length === 0) return;
    const step = e.key === "ArrowDown" ? 1 : -1;
    // Wraps through -1, the "nothing highlighted" slot, so arrowing back past
    // the first row returns to what was typed rather than jumping to the last.
    setHighlight((at) => {
      const next = at + step;
      if (next < -1) return options.length - 1;
      if (next >= options.length) return -1;
      return next;
    });
  };

  return (
    <div ref={rootRef} className="relative min-w-0 flex-1">
      <input
        role="combobox"
        aria-expanded={active}
        aria-controls={active ? listId : undefined}
        aria-autocomplete="list"
        aria-label={ariaLabel}
        value={value}
        maxLength={maxLength}
        placeholder={placeholder}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          // Filtering has just changed what the rows are, so a held highlight
          // would point at something the reader is no longer looking at.
          setHighlight(-1);
        }}
        onKeyDown={onKeyDown}
        className={
          "w-full rounded-[4px] border border-[var(--color-border)] bg-[var(--color-surface-alt)] " +
          "py-2 pr-9 pl-3 text-[14px] text-[var(--color-text)] " +
          "placeholder:text-[var(--color-text-muted)] " +
          "focus:border-[var(--color-accent)] focus:outline-none"
        }
      />
      <button
        type="button"
        tabIndex={-1}
        aria-label={open ? "Hide suggestions" : "Show suggestions"}
        // Handled on pointerdown so the dismiss listener above cannot close the
        // list and this press reopen it on the same tap.
        onPointerDown={(e) => {
          e.preventDefault();
          setOpen((was) => !was);
        }}
        className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-[var(--color-text-muted)] transition-colors duration-100 hover:text-[var(--color-text)]"
      >
        <ChevronUp size={16} />
      </button>

      {active && (
        <ul
          id={listId}
          role="listbox"
          className={
            // Opens upward: the field sits at the bottom of its sheet, so there
            // is nothing below it to open into.
            "absolute bottom-[calc(100%+4px)] right-0 left-0 z-10 max-h-[320px] overflow-y-auto " +
            "rounded-[4px] border border-[var(--color-border)] bg-[var(--color-surface)] py-1 " +
            "shadow-[0_4px_12px_rgba(0,0,0,0.18)]"
          }
        >
          {groups.map((group, groupIndex) => (
            <li key={group.label} role="presentation">
              <p className="px-3 pt-1.5 pb-1 text-[11px] tracking-wide text-[var(--color-text-muted)] uppercase">
                {group.label}
              </p>
              <ul role="presentation">
                {group.options.map((option, optionIndex) => {
                  // Position in the flattened list, which is what the arrow
                  // keys walk.
                  const index = offsets[groupIndex] + optionIndex;
                  return (
                    <li key={option.value} role="presentation">
                      <button
                        type="button"
                        role="option"
                        aria-selected={index === highlight}
                        // Pointerdown again: committing on click would first
                        // blur the field and dismiss the list out from under it.
                        onPointerDown={(e) => {
                          e.preventDefault();
                          commit(option.value);
                        }}
                        onPointerEnter={() => setHighlight(index)}
                        className={
                          "block w-full px-3 py-1.5 text-left text-[14px] text-[var(--color-text)] " +
                          (index === highlight
                            ? "bg-[var(--color-surface-alt)]"
                            : "")
                        }
                      >
                        {option.label}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
