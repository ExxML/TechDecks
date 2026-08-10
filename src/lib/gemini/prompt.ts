/**
 * Prompt construction for MCQ generation.
 *
 * Bump PROMPT_VERSION whenever this file's output changes, so stored sets stay
 * attributable to the prompt that produced them.
 */

export const PROMPT_VERSION = 1;

export type PromptInput = {
  readonly title: string;
  readonly difficulty: string | null;
  readonly tags: readonly string[];
  readonly bodyText: string;
  readonly kinds: readonly string[];
  /** Absent for authored problems, which may not be coding problems at all. */
  readonly language?: string | null;
  /** The exact function signature for `language`, when the source provides one. */
  readonly signature?: string | null;
  readonly hints?: readonly string[];
  readonly exampleTestcases?: string | null;
};

export const SYSTEM_INSTRUCTION = `You write multiple-choice questions that train pattern recognition for technical interviews.

Work in two stages, in a single response:

STAGE 1 (internal). Derive the optimal solution to the problem yourself: the
approach, the algorithm, its time and space complexity, and working code. Do
not output this stage.

STAGE 2. Write the requested multiple-choice questions, every one of them
consistent with the solution you derived in stage 1. No external solution is
provided to you, so self-consistency is what keeps the Algorithm, Complexity,
and Solution questions from contradicting each other.

Rules:
- Emit exactly the requested kinds, in the requested order, one question each.
- Set each question's "kind" field to the requested kind string verbatim.
- Every question has exactly 4 options.
- Exactly one option is correct.
- Distractors must be plausible, not filler: a common wrong approach, an
  off-by-one complexity (O(n log n) where the answer is O(n)), a subtly broken
  edge case. A distractor nobody would pick teaches nothing.
- Write "explanation" before deciding "correct_index": explain why the correct
  option is correct AND why the plausible distractors fail.
- Never mention "the provided context", "the solution above", "the description",
  or the fact that you were given anything. The reader sees only the question.
- Do not restate the full problem in the question text.`;

const KIND_RULES: Readonly<Record<string, string>> = {
  approach:
    'approach: ask which problem-solving strategy the problem calls for. Options are strategy names with a brief clause, not code.',
  algorithm:
    'algorithm: ask for the optimal algorithm and its key mechanic. Options describe concrete methods, not vague categories.',
  complexity:
    'complexity: ask for the optimal time AND space complexity. Every option must state both, e.g. "O(n) time, O(1) space".',
  solution:
    'solution: the 4 options are complete code blocks. They must differ substantively — a different algorithm, a real bug, a wrong complexity — never cosmetically (renamed variables, reordered lines).',
};

export function buildPrompt(input: PromptInput): string {
  const parts: string[] = [];

  parts.push(`# Problem\n\nTitle: ${input.title}`);
  if (input.difficulty) parts.push(`Difficulty: ${input.difficulty}`);
  if (input.tags.length > 0) parts.push(`Topics: ${input.tags.join(', ')}`);

  parts.push(`\n## Description\n\n${input.bodyText}`);

  if (input.exampleTestcases) {
    parts.push(`\n## Example test cases\n\n${input.exampleTestcases}`);
  }

  if (input.hints && input.hints.length > 0) {
    parts.push(`\n## Hints from the problem source\n\n${input.hints.map((h) => `- ${h}`).join('\n')}`);
  }

  // Omitted entirely rather than sent empty: asserting a language for a problem
  // that has none produces confidently wrong questions.
  if (input.language) {
    parts.push(`\n## Target language\n\n${input.language}`);
    if (input.signature) {
      parts.push(
        `Write all code against exactly this signature, so it compiles against the real harness:\n\n\`\`\`\n${input.signature}\n\`\`\``,
      );
    }
  }

  parts.push(`\n# Questions to write\n\nWrite exactly ${input.kinds.length} question(s), in this order:`);
  input.kinds.forEach((kind, i) => {
    const rule = KIND_RULES[kind.toLowerCase()];
    parts.push(`${i + 1}. kind = "${kind}"${rule ? `\n   ${rule}` : ''}`);
  });

  // Only assert "complete code blocks" when a solution kind was actually
  // requested and a language exists to write them in.
  const wantsSolution = input.kinds.some((k) => k.toLowerCase() === 'solution');
  if (wantsSolution && !input.language) {
    parts.push(
      '\nNo target language was specified. For the "solution" kind, describe each candidate solution in precise prose or pseudocode rather than a specific language.',
    );
  }

  return parts.join('\n');
}
