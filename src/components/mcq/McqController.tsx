'use client';

import { useCallback, useEffect, useState } from 'react';
import { McqStrip } from './McqStrip';
import { GenerateOptionsSheet } from './GenerateOptionsSheet';
import { HistoryPicker } from './HistoryPicker';
import { ApiKeyDialog } from '../ApiKeyDialog';
import { Button } from '../ui/Button';
import { Skeleton } from '../ui/Skeleton';
import { useSettings } from '@/lib/settings';
import { useGeneration, mcqStore } from '@/lib/mcq/generation';
import { PRESET_KINDS } from '@/lib/gemini/schema';
import type { McqSet } from '@/lib/mcq/store';
import type { ContentItem } from '@/lib/types';

/** Synced problems always generate these, so the preview reads from the source. */
const KINDS: readonly string[] = PRESET_KINDS;

const titleCase = (k: string) => k.charAt(0).toUpperCase() + k.slice(1);

type Props = {
  readonly item: ContentItem;
  /** Card asks to switch to State B (questions) or back to State A (reading). */
  readonly onEnterQuestions: () => void;
  readonly inQuestions: boolean;
  /** State B was entered with no set to show — send the card back to State A
   *  rather than rendering an empty strip. */
  readonly onNoSet: () => void;
};

/**
 * Owns MCQ state for one card: the action bar in State A, the strip in State B.
 *
 * All reads and writes go through mcqStore, so swapping the McqStore
 * implementation changes nothing here.
 */
export function McqController({ item, onEnterQuestions, inQuestions, onNoSet }: Props) {
  const apiKey = useSettings((s) => s.apiKey);
  const hydrated = useSettings((s) => s.hydrated);
  const hydrate = useSettings((s) => s.hydrate);

  const status = useGeneration((s) => s.statusByItem[item.id] ?? 'idle');
  const error = useGeneration((s) => s.errorByItem[item.id] ?? null);
  const version = useGeneration((s) => s.versionByItem[item.id] ?? 0);
  const generate = useGeneration((s) => s.generate);
  const bump = useGeneration((s) => s.bump);

  const [sets, setSets] = useState<readonly McqSet[]>([]);
  const [activeSetId, setActiveSetId] = useState<string | null>(null);
  const [showOptions, setShowOptions] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showKeyDialog, setShowKeyDialog] = useState(false);

  useEffect(() => hydrate(), [hydrate]);

  // Re-read whenever this problem's sets change.
  useEffect(() => {
    let cancelled = false;
    void mcqStore.list(item.id).then((list) => {
      if (cancelled) return;
      setSets(list);
      setActiveSetId((current) => (current && list.some((s) => s.id === current) ? current : (list[0]?.id ?? null)));
    });
    return () => {
      cancelled = true;
    };
  }, [item.id, version]);

  const activeSet = sets.find((s) => s.id === activeSetId) ?? null;

  const runGeneration = useCallback(
    async (model: string, language: string | null) => {
      if (!apiKey) return;
      const saved = await generate({
        contentItemId: item.id,
        apiKey,
        model,
        language,
        kinds: KINDS,
      });
      if (saved) {
        setActiveSetId(saved.id);
        onEnterQuestions();
      }
    },
    [apiKey, generate, item.id, onEnterQuestions],
  );

  // Tapping Generate with no key opens the dialog inline, then proceeds with
  // the generation the user originally asked for.
  const requestGenerate = () => {
    if (!apiKey) setShowKeyDialog(true);
    else setShowOptions(true);
  };

  const onAnswer = async (index: number, selectedIndex: number) => {
    if (!activeSet) return;
    await mcqStore.recordAnswer(activeSet.id, index, selectedIndex);
    bump(item.id);
  };

  const onRetry = async () => {
    if (!activeSet) return;
    await mcqStore.reset(activeSet.id);
    bump(item.id);
  };

  const onDelete = async (setId: string) => {
    await mcqStore.remove(setId);
    bump(item.id);
  };

  // State B. An ungenerated card must never render a zero-length strip with
  // zero dots — that reads as broken — so fall back to State A instead.
  if (inQuestions) {
    if (!activeSet) {
      return <StateBFallback onBack={onNoSet} />;
    }
    return (
      <McqStrip
        set={activeSet}
        onAnswer={onAnswer}
        onRetry={onRetry}
        onRegenerate={() => setShowOptions(true)}
      />
    );
  }

  const generating = status === 'generating';
  const latest = sets[0];

  return (
    <div className="border-t border-[var(--color-border)] px-4 py-3">
      {generating ? (
        <>
          <Button variant="primary" className="w-full" disabled>
            Generating questions… ~20s
          </Button>
          <div className="mt-2 flex gap-2">
            <Skeleton className="h-2 flex-1" />
            <Skeleton className="h-2 flex-1" />
            <Skeleton className="h-2 flex-1" />
          </div>
        </>
      ) : (
        <>
          <Button
            variant="primary"
            className="w-full"
            onClick={() => (sets.length > 0 ? onEnterQuestions() : requestGenerate())}
          >
            {sets.length > 0 ? 'Start' : 'Generate Questions'}
          </Button>

          {sets.length === 0 && (
            <p className="mt-1.5 text-center text-[13px] leading-none text-[var(--color-text-muted)]">
              {hydrated && !apiKey
                ? 'Needs a Gemini API key.'
                : `${KINDS.length} questions · ${KINDS.map(titleCase).join(', ')}`}
            </p>
          )}

          {sets.length > 0 && (
            <div className="mt-1.5 flex items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => setShowHistory(true)}
                className="text-[13px] leading-none text-[var(--color-text-muted)] underline underline-offset-2"
              >
                {sets.length} set{sets.length === 1 ? '' : 's'}
                {latest ? ` · latest ${scoreOf(latest)}` : ''}
              </button>
              <button
                type="button"
                onClick={requestGenerate}
                className="text-[13px] leading-none text-[var(--color-text-muted)] underline underline-offset-2"
              >
                Regenerate
              </button>
            </div>
          )}
        </>
      )}

      {error && <p className="mt-2 text-center text-[12px] text-[var(--color-incorrect)]">{error}</p>}

      <GenerateOptionsSheet
        open={showOptions}
        onClose={() => setShowOptions(false)}
        snippets={item.metadata.codeSnippets ?? []}
        onConfirm={(model, language) => void runGeneration(model, language)}
      />
      <HistoryPicker
        open={showHistory}
        onClose={() => setShowHistory(false)}
        sets={sets}
        activeSetId={activeSetId}
        onSelect={(id) => {
          setActiveSetId(id);
          onEnterQuestions();
        }}
        onDelete={(id) => void onDelete(id)}
        onRegenerate={requestGenerate}
      />
      <ApiKeyDialog
        open={showKeyDialog}
        onClose={() => setShowKeyDialog(false)}
        onSaved={() => setShowOptions(true)}
      />
    </div>
  );
}

/** Only reachable if a set is deleted while State B is open. */
function StateBFallback({ onBack }: { readonly onBack: () => void }) {
  return (
    <div className="flex min-h-0 flex-col items-center justify-center gap-2 px-4">
      <p className="text-[13px] text-[var(--color-text-muted)]">No questions for this problem.</p>
      <button
        type="button"
        onClick={onBack}
        className="text-[13px] text-[var(--color-accent)] underline underline-offset-2"
      >
        Back to description
      </button>
    </div>
  );
}

function scoreOf(set: McqSet): string {
  const answered = set.answers.filter((a) => a !== null);
  if (answered.length === 0) return 'not started';
  const correct = answered.filter((a) => a?.correct).length;
  return `${correct}/${set.questions.length}`;
}
