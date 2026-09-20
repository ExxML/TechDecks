import { z } from 'zod';

/**
 * Single source of truth for the shape of Gemini I/O: what a valid MCQ is and
 * which kinds a problem requests. What to actually ask for each kind lives in
 * `prompt.ts`.
 *
 * These schemas drive three things at once: Gemini's `responseSchema`, the
 * runtime parse of what comes back, and the TypeScript types. Never
 * hand-maintain a parallel interface — derive with z.infer.
 */

/** The fixed four for synced problems. Authored problems define their own. */
export const PRESET_KINDS = ['approach', 'algorithm', 'complexity', 'solution'] as const;

/**
 * Every kind `prompt.ts` writes specific guidance for, grouped by the kind of
 * problem it suits. Offered as a menu so an author picks a kind the prompt
 * actually knows how to ask for; kinds stay free text, so a hardware problem
 * can still define "Timing".
 *
 * Each kind appears in one group only, and every entry must have a KIND_RULES
 * key — a kind listed here without one is offered as a suggestion the prompt
 * cannot honour.
 */
export const KIND_GROUPS = [
  {
    label: 'DSA',
    kinds: [
      'approach',
      'algorithm',
      'complexity',
      'solution',
      'edge_case',
      'data_structure',
      'bit_manipulation',
    ],
  },
  {
    label: 'Design',
    kinds: ['tradeoff', 'scaling', 'consistency', 'failure_mode', 'api_design', 'bottleneck'],
  },
  { label: 'Low-Level', kinds: ['memory', 'concurrency'] },
  { label: 'Quant', kinds: ['probability', 'math', 'estimation'] },
] as const satisfies ReadonlyArray<{ label: string; kinds: readonly string[] }>;

/**
 * The kinds a problem generates, and whether that generation is grounded.
 *
 * Synced problems always use the preset four in fixed order; the user does not
 * choose. Authored problems use the 1–8 kinds their author defined and carry no
 * `codeSnippets`, so they sit at the bottom of the grounding ladder and their
 * sets must be badged accordingly.
 *
 * Read by both the generate route and the card controller, so the kind list and
 * the grounded flag cannot disagree between them.
 */
export function kindsForItem(item: {
  readonly source_id: string;
  readonly metadata: { readonly kinds?: unknown; readonly codeSnippets?: unknown };
}): { readonly kinds: readonly string[]; readonly grounded: boolean } {
  if (item.source_id !== 'user') {
    const snippets = item.metadata.codeSnippets;
    return {
      kinds: [...PRESET_KINDS],
      grounded: Array.isArray(snippets) && snippets.length > 0,
    };
  }

  const raw = item.metadata.kinds;
  const kinds = Array.isArray(raw) ? raw.filter((k): k is string => typeof k === 'string') : [];
  return {
    // An authored problem saved before kinds existed still generates something
    // rather than failing the request outright.
    kinds: kinds.length > 0 ? kinds.slice(0, 8) : [...PRESET_KINDS],
    grounded: false,
  };
}

export const McqSchema = z.object({
  kind: z.string().min(1).max(40), // preset or author-defined
  question: z.string().min(10),
  options: z.array(z.object({ text: z.string().min(1) })).length(4),
  /** Optional: sets generated before hints existed carry none, and the panel
   *  hides the control rather than backfilling them. */
  hint: z.string().min(10).optional(),
  explanation: z.string().min(10),
  correct_index: z.number().int().min(0).max(3),
});

export type Mcq = z.infer<typeof McqSchema>;

/**
 * The requested-kinds list. Validated on every generate request, since that
 * route is a public surface and cannot trust a client-supplied list.
 */
export const RequestedKindsSchema = z
  .array(z.string().min(1).max(40))
  .min(1)
  .max(8)
  .refine((ks) => new Set(ks.map((k) => k.toLowerCase())).size === ks.length, {
    message: 'duplicate kinds',
  });

/**
 * Validates that the model returned exactly the requested kinds, in order.
 * This is what catches a model silently dropping or renaming a question,
 * rather than letting a short set reach storage.
 */
export const mcqSetSchema = (requestedKinds: readonly string[]) =>
  z.object({
    questions: z
      .array(McqSchema)
      .length(requestedKinds.length)
      .refine((qs) => qs.every((q, i) => q.kind === requestedKinds[i]), {
        message: 'returned kinds do not match requested kinds',
      }),
  });

/**
 * Gemini's `responseSchema` — OpenAPI-subset, not JSON Schema, so it is built
 * by hand rather than derived from Zod.
 *
 * `propertyOrdering` matters: `hint` then `explanation` come BEFORE
 * `correct_index`, so the model writes the nudge and reasons through the answer
 * before committing to an index.
 */
export function buildResponseSchema(kindCount: number) {
  return {
    type: 'OBJECT',
    properties: {
      questions: {
        type: 'ARRAY',
        minItems: kindCount,
        maxItems: kindCount,
        items: {
          type: 'OBJECT',
          properties: {
            kind: { type: 'STRING' },
            question: { type: 'STRING' },
            options: {
              type: 'ARRAY',
              minItems: 4,
              maxItems: 4,
              items: {
                type: 'OBJECT',
                properties: { text: { type: 'STRING' } },
                required: ['text'],
                propertyOrdering: ['text'],
              },
            },
            hint: { type: 'STRING' },
            explanation: { type: 'STRING' },
            correct_index: { type: 'INTEGER' },
          },
          required: ['kind', 'question', 'options', 'hint', 'explanation', 'correct_index'],
          propertyOrdering: [
            'kind',
            'question',
            'options',
            'hint',
            'explanation',
            'correct_index',
          ],
        },
      },
    },
    required: ['questions'],
    propertyOrdering: ['questions'],
  } as const;
}

/** Request body accepted by POST /api/gemini/generate. */
export const GenerateRequestSchema = z.object({
  contentItemId: z.string().uuid(),
  model: z.string().min(1).max(200),
  language: z.string().min(1).max(40).nullable(),
  kinds: RequestedKindsSchema,
});

