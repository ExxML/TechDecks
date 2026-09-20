/**
 * Prompt construction for MCQ generation.
 *
 * Bump PROMPT_VERSION whenever this file's output changes, so stored sets stay
 * attributable to the prompt that produced them.
 */

export const PROMPT_VERSION = 3;

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

STAGE 1 (internal). Derive the optimal solution yourself: approach, algorithm,
time and space complexity, and working code. Do not output this stage.

STAGE 2. Write the requested questions, every one consistent with that
solution. No external solution is given to you, so self-consistency is what
keeps the questions from contradicting each other.

Rules:
- Emit exactly the requested kinds, in the requested order, one question each,
  with "kind" set to the requested string verbatim.
- Every question has exactly 4 options, exactly one correct.
- All 4 options must be the same kind of thing, at the same level of detail and
  comparable length. The correct one must not stand out as the longest, the
  most precise, or the only one that is fully specified.
- Distractors must be plausible, not filler: a common wrong approach, an
  off-by-one complexity (O(n log n) where the answer is O(n)), a subtly broken
  edge case. A distractor nobody would pick teaches nothing.
- Vary which index is correct across the set; do not favour any position.
- Each question must stand alone and be decidable from the problem itself. Do
  not restate the full problem, and never reference other questions or their
  options ("as in option B", "unlike question 2").
- Write "hint" before "explanation", and "explanation" before deciding
  "correct_index": explain why the correct option is correct AND why each
  plausible distractor fails.
- Never mention "the provided context", "the solution above", "the description",
  or the fact that you were given anything. The reader sees only the question.

The reader works through the questions in order and reads a hint only after
being stuck on that question, so each "hint":
- Is one or two sentences that narrow the field — name the property of the
  problem that decides the answer, or the question worth asking of each option.
- Never names, quotes, or points at an option, and never gives the answer away.
  A hint that leaves nothing to decide is a spoiler, not a hint.
- May build on the earlier questions in this set, whose answers the reader has
  already seen, but never depends on a later one.`;

/**
 * Per-kind guidance appended to the numbered kind list. Keys are lowercase.
 * Covers the preset four plus the kinds authored problems commonly define
 * across DSA, system design, low-level, and quant practice.
 */
const KIND_RULES: Readonly<Record<string, string>> = {
  approach:
    'approach: ask which problem-solving strategy the problem calls for and why. Options name a strategy plus the property of the problem that justifies it — never code.',
  algorithm:
    'algorithm: ask for the optimal algorithm and its key mechanic (what is stored, what each step does). Options describe concrete named methods, not vague categories like "use a loop".',
  complexity:
    'complexity: ask for the optimal time AND space complexity. Every option states both, e.g. "O(n) time, O(1) space", using the same variable names as the problem.',
  solution:
    'solution: the 4 options are complete, runnable implementations, each option nothing but the code itself. Options must differ substantively — a different algorithm, a real bug, a worse complexity — never cosmetically (renamed variables, reordered lines).',
  edge_case:
    'edge_case: ask which input breaks a stated approach, or which case the correct solution must special-case. Options are concrete inputs or conditions (empty input, single element, overflow, duplicates, cycles), not abstract descriptions.',
  tradeoff:
    'tradeoff: ask which design choice is right under a stated constraint, and make the constraint explicit in the question. Options each name a choice and the cost it pays.',
  data_structure:
    'data_structure: ask which data structure the required operations call for. Options name a structure and the operation cost that decides it, e.g. "heap — O(log n) insert and extract-min".',
  bottleneck:
    'bottleneck: ask which step dominates cost or which resource saturates first. Options each name a specific step or resource, not a general worry.',
  scaling:
    'scaling: ask what breaks first as load, data size, or node count grows, or which change absorbs that growth. Options are concrete mechanisms (sharding key, read replica, cache tier, backpressure), each with the failure it addresses.',
  consistency:
    'consistency: ask which consistency, durability, or isolation guarantee the stated requirement needs, or what anomaly a given choice permits. Options name a precise guarantee or anomaly (read-your-writes, stale read, write skew, lost update).',
  failure_mode:
    'failure_mode: ask what happens when a component fails, a request retries, or a partition occurs. Options are specific observable outcomes, not "the system goes down".',
  api_design:
    'api_design: ask which interface, schema, or contract best fits the stated requirement. Options are concrete signatures or endpoint shapes that differ in a meaningful property (idempotency, pagination, error surface).',
  memory:
    'memory: ask about layout, allocation, ownership, or lifetime — stack vs heap, alignment, padding, cache locality, leaks, use-after-free. Options state a concrete size, layout, or lifetime outcome.',
  concurrency:
    'concurrency: ask which interleaving, synchronisation primitive, or memory-ordering guarantee applies. Options name a specific race, deadlock, or primitive, and what it does or does not prevent.',
  bit_manipulation:
    'bit_manipulation: ask what a bitwise expression computes or which one achieves a stated effect. Options are concrete expressions or exact resulting values.',
  probability:
    'probability: ask for an exact probability, expectation, or variance. Options are closed-form values or expressions, stated in the same form (all fractions, or all decimals to the same precision), with distractors reflecting real errors — a missed conditioning, a wrong denominator, double counting.',
  math:
    'math: ask for the quantity, identity, or bound the problem turns on. Options are exact expressions or values in a consistent form, with distractors from realistic algebraic slips.',
  estimation:
    'estimation: ask for an order-of-magnitude figure and state the assumptions the reader may use. Options are separated by roughly a factor of ten so the reasoning, not arithmetic precision, decides the answer.',
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

  // Only ask for real code when a language exists to write it in.
  const wantsSolution = input.kinds.some((k) => k.toLowerCase() === 'solution');
  if (wantsSolution && !input.language) {
    parts.push(
      '\nNo target language was specified. For the "solution" kind, write each option as language-agnostic pseudocode.',
    );
  }

  return parts.join('\n');
}
