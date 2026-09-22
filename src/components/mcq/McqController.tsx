'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { SquarePen } from 'lucide-react';
import { McqStrip } from './McqStrip';
import { GenerateOptionsSheet } from './GenerateOptionsSheet';
import { HistoryPicker } from './HistoryPicker';
import { ApiKeyDialog } from '../ApiKeyDialog';
import { Button } from '../ui/Button';
import { useSettings } from '@/lib/settings';
import { useGeneration } from '@/lib/mcq/generation';
import { getMcqStore } from '@/lib/mcq/provider';
import { useUser } from '@/lib/auth';
import { useStoredKey } from '@/lib/gemini/useStoredKey';
import { kindsForItem } from '@/lib/gemini/schema';
import type { McqSet } from '@/lib/mcq/store';
import type { ContentItem } from '@/lib/types';

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
  const startedAt = useGeneration((s) => s.startedAtByItem[item.id] ?? null);
  const version = useGeneration((s) => s.versionByItem[item.id] ?? 0);
  const globalVersion = useGeneration((s) => s.globalVersion);
  const generate = useGeneration((s) => s.generate);
  const bump = useGeneration((s) => s.bump);
  const cacheSets = useGeneration((s) => s.cacheSets);

  // What the last read for this problem returned, if any. Read once for the
  // initial state: a remount — toggling states, or paging back into the
  // window — then has the sets on its first frame, so the action bar never
  // paints "Generate Questions" over a problem that already has sets.
  const cached = useGeneration.getState().setsByItem[item.id];

  const [sets, setSets] = useState<readonly McqSet[]>(cached ?? []);
  // False until the first read resolves, so State B can tell "still loading"
  // apart from "genuinely none" and not flash the fallback at an entry. A
  // cached mount is already past that.
  const [loaded, setLoaded] = useState(cached !== undefined);
  const [activeSetId, setActiveSetId] = useState<string | null>(cached?.[0]?.id ?? null);
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
        // Cached even when this card is gone: the next mount is what benefits.
        cacheSets(item.id, list);
        if (cancelled) return;
        setSets(list);
        setActiveSetId((current) =>
          current && list.some((s) => s.id === current) ? current : (list[0]?.id ?? null),
        );
      })
      .catch(() => {
        if (!cancelled) setSets([]);
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [item.id, version, globalVersion, store, cacheSets]);

  // Either source counts: a pasted key for this tab, or one stored in Vault
  // that the server will read on our behalf. Null while the Vault check is
  // still out — unknown, not absent.
  const canGenerate = Boolean(apiKey) || vaultKey;
  const keyless = canGenerate === false;

  const activeSet = sets.find((s) => s.id === activeSetId) ?? null;

  const runGeneration = useCallback(
    async (model: string, language: string | null, kinds: readonly string[]) => {
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
    [apiKey, generate, item, onEnterQuestions, store],
  );

  // Tapping Generate with no key opens the dialog inline, then proceeds with
  // the generation the user originally asked for.
  const requestGenerate = () => {
    if (keyless) setShowKeyDialog(true);
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

  const onResetOne = async (index: number) => {
    if (!activeSet) return;
    await store.resetAnswer(activeSet.id, index);
    bump(item.id);
  };

  const onDelete = async (setId: string) => {
    await store.remove(setId);
    bump(item.id);
  };

  // State B. An ungenerated card must never render a zero-length strip with
  // zero dots — that reads as broken — so fall back to State A instead.
  if (inQuestions) {
    // The strip mounts fresh on entry, so hold the frame until the sets are in
    // rather than showing the fallback over a set that is about to arrive.
    if (!loaded) return null;
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
        onResetOne={(index) => void onResetOne(index)}
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
        <GeneratingButton startedAt={startedAt} />
      ) : (
        <>
          {/* One row, always. An element on its own line would change the
              bar's height and break the alignment between Start here and the
              stepper's Description button in State B — the two targets a thumb
              toggles between without moving. */}
          <div className="flex items-stretch gap-2">
            {sets.length > 0 && (
              <button
                type="button"
                onClick={() => setShowHistory(true)}
                aria-label={`Manage sets — ${sets.length} saved${latest ? `, latest ${scoreOf(latest)}` : ''}`}
                className="flex shrink-0 items-center gap-1.5 rounded-[4px] border border-[var(--color-border)] px-2.5 text-[13px] leading-none text-[var(--color-text-muted)] transition-colors duration-100 hover:text-[var(--color-text)]"
              >
                <SquarePen size={16} />
                {/* Kept beside the icon: the sheet is otherwise the only place
                    progress is visible, and it costs no extra row here. */}
                {latest ? scoreOf(latest) : sets.length}
              </button>
            )}

            <Button
              variant="primary"
              className="flex-1"
              onClick={() => (sets.length > 0 ? onEnterQuestions() : requestGenerate())}
            >
              {sets.length > 0 ? 'Start' : 'Generate Questions'}
            </Button>
          </div>

          {sets.length === 0 && hydrated && keyless && (
            <p className="mt-1.5 text-center text-[13px] leading-none text-[var(--color-text-muted)]">
              Needs a Gemini API key.
            </p>
          )}
        </>
      )}

      {error && <p className="mt-2 text-center text-[12px] text-[var(--color-incorrect)]">{error}</p>}

      <GenerateOptionsSheet
        open={showOptions}
        onClose={() => setShowOptions(false)}
        snippets={item.metadata.codeSnippets ?? []}
        kinds={kinds}
        onConfirm={(model, language, requested) => void runGeneration(model, language, requested)}
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

/**
 * Disabled CTA for an in-flight generation: a travelling bar for liveness and
 * a count of seconds elapsed. No percentage — the model returns the whole set
 * in one response, so there is no progress to report, only proof of life.
 */
function GeneratingButton({ startedAt }: { readonly startedAt: number | null }) {
  // Ticks the clock; the displayed value is derived from startedAt, so a
  // remount mid-generation picks up the real elapsed time rather than zero.
  const [, tick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const elapsed = elapsedSeconds(startedAt);

  return (
    <Button variant="primary" className="relative w-full overflow-hidden" disabled>
      Generating questions… {elapsed}s
      <span className="absolute inset-x-0 bottom-0 h-[2px]" aria-hidden="true">
        <span className="progress-sweep block h-full bg-[var(--color-on-accent)]" />
      </span>
    </Button>
  );
}

function elapsedSeconds(startedAt: number | null): number {
  return startedAt === null ? 0 : Math.floor((Date.now() - startedAt) / 1000);
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
