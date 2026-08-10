'use client';

import { useState } from 'react';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { Select } from './ui/Select';
import { KindEditor, MAX_KINDS } from './KindEditor';
import { PRESET_KINDS } from '@/lib/gemini/schema';
import type { AuthoredProblemInput } from '@/lib/queries';
import type { ContentItem, Difficulty } from '@/lib/types';

type Props = {
  /** Absent when creating. */
  readonly initial?: ContentItem;
  readonly onSave: (input: AuthoredProblemInput) => Promise<void>;
  readonly onCancel: () => void;
};

/** Kinds live in metadata; an older row without them falls back to the presets. */
function initialKinds(item: ContentItem | undefined): readonly string[] {
  const kinds = (item?.metadata.kinds ?? []).slice(0, MAX_KINDS);
  if (kinds.length > 0) return kinds;
  // New problems start from the presets, since many authored problems are still
  // coding problems; the author can clear them.
  return [...PRESET_KINDS];
}

function initialLanguage(item: ContentItem | undefined): string {
  return item?.metadata.language ?? '';
}

/**
 * Create/edit form for an authored problem.
 *
 * The body is markdown, rendered by `markdownToHtml` and then sanitized —
 * authored HTML is no more trusted than scraped HTML, since a shared account or
 * a future export path would carry it.
 */
export function ProblemEditor({ initial, onSave, onCancel }: Props) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [body, setBody] = useState(initial?.body_html ?? '');
  const [difficulty, setDifficulty] = useState<Difficulty | ''>(initial?.difficulty ?? '');
  const [tagText, setTagText] = useState((initial?.tags ?? []).map((t) => t.name).join(', '));
  const [language, setLanguage] = useState(initialLanguage(initial));
  const [kinds, setKinds] = useState<readonly string[]>(initialKinds(initial));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid = title.trim().length > 0 && body.trim().length > 0 && kinds.length > 0;

  const submit = async () => {
    if (!valid || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSave({
        title: title.trim(),
        body,
        difficulty: difficulty === '' ? null : difficulty,
        tags: tagText
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
        // Empty means "no language" — the prompt omits the slot entirely rather
        // than asserting a language a non-coding problem does not have.
        language: language.trim() || null,
        kinds,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
      setSaving(false);
    }
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className="flex flex-col gap-4"
    >
      <div>
        <label htmlFor="pe-title" className="mb-1.5 block text-[12px] text-[var(--color-text-muted)]">
          Title
        </label>
        <Input
          id="pe-title"
          value={title}
          maxLength={200}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Rate limiter design"
        />
      </div>

      <div>
        <label htmlFor="pe-body" className="mb-1.5 block text-[12px] text-[var(--color-text-muted)]">
          Description
        </label>
        <textarea
          id="pe-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={10}
          placeholder={'Markdown. # headings, **bold**, `code`, ``` fences, - lists.'}
          className="w-full rounded-[4px] border border-[var(--color-border)] bg-[var(--color-surface-alt)] px-3 py-2 font-mono text-[13px] leading-[1.6] text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-accent)] focus:outline-none"
        />
      </div>

      <div className="flex gap-3">
        <div className="flex-1">
          <label
            htmlFor="pe-difficulty"
            className="mb-1.5 block text-[12px] text-[var(--color-text-muted)]"
          >
            Difficulty
          </label>
          <Select
            id="pe-difficulty"
            value={difficulty}
            onChange={(e) => setDifficulty(e.target.value as Difficulty | '')}
          >
            <option value="">None</option>
            <option value="easy">Easy</option>
            <option value="medium">Medium</option>
            <option value="hard">Hard</option>
          </Select>
        </div>
        <div className="flex-1">
          <label
            htmlFor="pe-language"
            className="mb-1.5 block text-[12px] text-[var(--color-text-muted)]"
          >
            Language
          </label>
          <Input
            id="pe-language"
            value={language}
            maxLength={40}
            onChange={(e) => setLanguage(e.target.value)}
            placeholder="Optional"
          />
        </div>
      </div>

      <div>
        <label htmlFor="pe-tags" className="mb-1.5 block text-[12px] text-[var(--color-text-muted)]">
          Tags
        </label>
        <Input
          id="pe-tags"
          value={tagText}
          onChange={(e) => setTagText(e.target.value)}
          placeholder="Comma separated, e.g. array, hash table"
        />
        <p className="mt-1 text-[12px] leading-[1.5] text-[var(--color-text-muted)]">
          Only existing topic tags are attached; unknown names are ignored.
        </p>
      </div>

      <div>
        <span className="mb-1.5 block text-[12px] text-[var(--color-text-muted)]">
          Question kinds
        </span>
        <KindEditor kinds={kinds} onChange={setKinds} />
      </div>

      {error && <p className="text-[12px] text-[var(--color-incorrect)]">{error}</p>}

      <div className="flex gap-2">
        <Button type="submit" variant="primary" className="flex-1" disabled={!valid || saving}>
          {saving ? 'Saving…' : initial ? 'Save changes' : 'Create problem'}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
