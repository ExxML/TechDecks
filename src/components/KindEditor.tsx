"use client";

import { useState } from "react";
import { X, Plus, GripVertical } from "lucide-react";
import { Combobox, type ComboboxGroup } from "./ui/Combobox";
import { KIND_GROUPS } from "@/lib/gemini/schema";
import { useReorder } from "@/lib/reorder";

/**
 * Author-defined question kinds, 1–8 entries, each 1–40 characters, no
 * duplicates. These are the same constraints `RequestedKindsSchema` enforces on
 * the generate route — this editor makes them visible, the route makes them
 * binding, since a client can call that route directly.
 *
 * Kinds are free text, not a menu: a hardware problem may want "Timing" and
 * "Power". The presets are offered as suggestions on that same field rather
 * than as a separate control, because a preset is a kind the prompt has written
 * guidance for and is the right choice most of the time.
 */
export const MAX_KINDS = 8;
export const MAX_KIND_LENGTH = 40;

type Props = {
  readonly kinds: readonly string[];
  readonly onChange: (kinds: readonly string[]) => void;
};

/** Presets are stored snake_case; the menu reads better spaced out and capitalised. */
const presetLabel = (k: string) => {
  const spaced = k.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
};

export function KindEditor({ kinds, onChange }: Props) {
  const [draft, setDraft] = useState("");

  const isDuplicate = (candidate: string) =>
    kinds.some((k) => k.toLowerCase() === candidate.toLowerCase());

  const add = (raw: string) => {
    const value = raw.trim().slice(0, MAX_KIND_LENGTH);
    if (!value || kinds.length >= MAX_KINDS || isDuplicate(value)) return;
    onChange([...kinds, value]);
    setDraft("");
  };

  const remove = (index: number) =>
    onChange(kinds.filter((_, i) => i !== index));

  const move = (from: number, to: number) => {
    const next = [...kinds];
    next.splice(to, 0, ...next.splice(from, 1));
    onChange(next);
  };

  const reorder = useReorder({ count: kinds.length, onReorder: move });

  const full = kinds.length >= MAX_KINDS;
  const draftInvalid = draft.trim().length > 0 && isDuplicate(draft.trim());

  // Presets already in the list are dropped rather than shown as rejected
  // picks, and typing narrows what is left. Empty groups fall away with them.
  const query = draft.trim().toLowerCase();
  const suggestions: ComboboxGroup[] = KIND_GROUPS.map((group) => ({
    label: group.label,
    options: group.kinds
      .filter(
        (k) => !isDuplicate(k) && presetLabel(k).toLowerCase().includes(query),
      )
      .map((k) => ({ value: k, label: presetLabel(k) })),
  })).filter((group) => group.options.length > 0);

  return (
    <div>
      {kinds.length > 0 && (
        <ol
          ref={(node) => reorder.ref(node)}
          className="mb-2 flex flex-col gap-1.5"
        >
          {kinds.map((kind, i) => {
            const lifted = reorder.active === i;
            return (
              <li
                key={`${kind}-${i}`}
                style={{
                  transform: `translateY(${lifted ? reorder.offset : reorder.shifts[i]}px)`,
                  // The lifted row rides above the rows it displaces, and its
                  // own travel is the finger's, so only the others animate.
                  transition:
                    reorder.active === null || lifted
                      ? undefined
                      : "transform 150ms",
                  zIndex: lifted ? 1 : undefined,
                }}
                className={
                  "relative flex items-center gap-2 rounded-[4px] border border-[var(--color-border)] " +
                  "bg-[var(--color-surface-alt)] py-2 pr-3 pl-1.5 " +
                  (lifted ? "shadow-[0_4px_12px_rgba(0,0,0,0.18)]" : "")
                }
              >
                <button
                  type="button"
                  {...reorder.handleProps}
                  data-index={i}
                  aria-label={`Reorder ${kind}`}
                  disabled={kinds.length < 2}
                  // The handle drives the gesture, so the browser must not pan
                  // the page or long-press-select from it.
                  className="touch-none cursor-grab text-[var(--color-text-muted)] transition-colors duration-100 select-none hover:text-[var(--color-text)] disabled:cursor-default disabled:opacity-40"
                >
                  <GripVertical size={16} />
                </button>
                <span className="w-4 text-[12px] leading-none text-[var(--color-text-muted)]">
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1 truncate text-[14px] text-[var(--color-text)]">
                  {kind}
                </span>
                <button
                  type="button"
                  onClick={() => remove(i)}
                  aria-label={`Remove ${kind}`}
                  className="text-[var(--color-text-muted)] transition-colors duration-100 hover:text-[var(--color-text)]"
                >
                  <X size={16} />
                </button>
              </li>
            );
          })}
        </ol>
      )}

      {!full && (
        <div className="flex gap-2">
          <Combobox
            value={draft}
            onChange={setDraft}
            onCommit={add}
            groups={suggestions}
            maxLength={MAX_KIND_LENGTH}
            placeholder="Add a question kind"
            aria-label="Add a question kind"
          />
          <button
            type="button"
            onClick={() => add(draft)}
            disabled={!draft.trim() || draftInvalid}
            aria-label="Add kind"
            className="flex w-10 shrink-0 items-center justify-center rounded-[4px] border border-[var(--color-border)] text-[var(--color-text-muted)] transition-colors duration-100 hover:text-[var(--color-text)] disabled:opacity-40"
          >
            <Plus size={16} />
          </button>
        </div>
      )}

      {draftInvalid && (
        <p className="mt-1 text-[12px] text-[var(--color-incorrect)]">
          That kind is already in the list.
        </p>
      )}

      <p className="mt-2 text-[12px] leading-[1.5] text-[var(--color-text-muted)]">
        {kinds.length === 0
          ? "Add at least one kind. Questions are generated in this order."
          : `${kinds.length} of ${MAX_KINDS} · generated in this order, drag to reorder.`}
      </p>
    </div>
  );
}
