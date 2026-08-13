'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { McqStrip } from './McqStrip';
import { GenerateOptionsSheet } from './GenerateOptionsSheet';
import { HistoryPicker } from './HistoryPicker';
import { ApiKeyDialog } from '../ApiKeyDialog';
import { Button } from '../ui/Button';
import { Skeleton } from '../ui/Skeleton';
import { useSettings } from '@/lib/settings';
import { useGeneration } from '@/lib/mcq/generation';
import { getMcqStore } from '@/lib/mcq/provider';
import { useUser } from '@/lib/auth';
import { useStoredKey } from '@/lib/gemini/useStoredKey';
import { kindsForItem } from '@/lib/gemini/schema';
import type { McqSet } from '@/lib/mcq/store';
import type { ContentItem } from '@/lib/types';

const titleCase = (k: string) => k.charAt(0).toUpperCase() + k.slice(1);

/** The author's free-text language, when they set one. Synced problems have
 *  none here — theirs come from codeSnippets via the options sheet. */
function authoredLanguage(item: ContentItem): string | null {
  const raw = item.metadata.language;
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
}

type Props = {
  readonly item: ContentItem;
  /** False on a peeking card, whose strip must not claim the keyboard. */
  readonly active: boolean;
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
export function McqController({ item, active, onEnterQuestions, inQuestions, onNoSet }: Props) {
  const { user } = useUser();
  const store = useMemo(() => getMcqStore(user?.id ?? null), [user?.id]);
  // Preset four for synced problems, the author's 1–8 for authored ones.
  const { kinds, grounded } = useMemo(() => kindsForItem(item), [item]);
  const apiKey = useSettings((s) => s.apiKey);
  // A signed-in user's key may live in Vault, where the browser cannot read it.
  // Only its EXISTENCE is visible here; the plaintext stays server-side.
  const vaultKey = useStoredKey();
  const hydrated = useSettings((s) => s.hydrated);
  const hydrate = useSettings((s) => s.hydrate);

  const status = useGeneration((s) => s.statusByItem[item.id] ?? 'idle');
  const error = useGeneration((s) => s.errorByItem[item.id] ?? null);
  const version = useGeneration((s) => s.versionByItem[item.id] ?? 0);
  const globalVersion = useGeneration((s) => s.globalVersion);
  const generate = useGeneration((s) => s.generate);
  const bump = useGeneration((s) => s.bump);

  const [sets, setSets] = useState<readonly McqSet[]>([]);
  const [activeSetId, setActiveSetId] = useState<string | null>(null);
  const [showOptions, setShowOptions] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showKeyDialog, setShowKeyDialog] = useState(false);

  useEffect(() => hydrate(), [hydrate]);

  // Re-read whenever this problem's sets change, or the store swaps on sign-in.
  useEffect(() => {
    let cancelled = false;
    void store
      .list(item.id)
      .then((list) => {
        if (cancelled) return;
        setSets(list);
        setActiveSetId((current) =>
          current && list.some((s) => s.id === current) ? current : (list[0]?.id ?? null),
        );
      })
      .catch(() => {
        if (!cancelled) setSets([]);
      });
    return () => {
      cancelled = true;
    };
  }, [item.id, version, globalVersion, store]);

  // Either source counts: a pasted key for this tab, or one stored in Vault
  // that the server will read on our behalf.
  const canGenerate = Boolean(apiKey) || vaultKey;

  const activeSet = sets.find((s) => s.id === activeSetId) ?? null;

  const runGeneration = useCallback(
    async (model: string, language: string | null) => {
      const saved = await generate({
        contentItemId: item.id,
        // Null when the key lives in Vault: the route resolves it server-side.
        apiKey,
        model,
        // Authored problems get no language from the options sheet, so theirs
        // comes from the problem. Null omits the prompt's language slot.
        language: language ?? authoredLanguage(item),
        kinds,
        store,
      });
      if (saved) {
        setActiveSetId(saved.id);
        onEnterQuestions();
      }
    },
    [apiKey, generate, item, kinds, onEnterQuestions, store],
  );

  // Tapping Generate with no key opens the dialog inline, then proceeds with
  // the generation the user originally asked for.
  const requestGenerate = () => {
    if (!canGenerate) setShowKeyDialog(true);
    else setShowOptions(true);
  };

  const onAnswer = async (index: number, selectedIndex: number) => {
    if (!activeSet) return;
    await store.recordAnswer(activeSet.id, index, selectedIndex);
    bump(item.id);
  };

  const onRetry = async () => {
    if (!activeSet) return;
    await store.reset(activeSet.id);
    bump(item.id);
  };

  const onDelete = async (setId: string) => {
    await store.remove(setId);
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
        grounded={grounded}
        active={active}
        onAnswer={onAnswer}
        onRetry={onRetry}
        onRegenerate={() => setShowOptions(true)}
        onExit={onNoSet}
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
              {hydrated && !canGenerate
                ? 'Needs a Gemini API key.'
                : `${kinds.length} question${kinds.length === 1 ? '' : 's'} · ${kinds.map(titleCase).join(', ')}`}
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
