import { z } from 'zod';

/**
 * Single source of truth for Gemini I/O.
 *
 * These schemas drive three things at once: Gemini's `responseSchema`, the
 * runtime parse of what comes back, and the TypeScript types. Never
 * hand-maintain a parallel interface — derive with z.infer.
 */

/** The fixed four for synced problems. Authored problems define their own. */
export const PRESET_KINDS = ['approach', 'algorithm', 'complexity', 'solution'] as const;

/**
 * Eyebrow labels. Authored kinds fall back to the raw kind name, which is why
 * this is a lookup rather than an exhaustive Record over PRESET_KINDS.
 */
export const KIND_LABELS: Readonly<Record<string, string>> = {
  approach: 'Understand the problem-solving strategy',
  algorithm: 'Learn the optimal solution method',
  complexity: 'Master Big O time and space analysis',
  solution: 'Choose the best complete final solution',
};

export const McqSchema = z.object({
  kind: z.string().min(1).max(40), // preset or author-defined
  question: z.string().min(10),
  options: z.array(z.object({ text: z.string().min(1) })).length(4),
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
 * `propertyOrdering` matters: `explanation` comes BEFORE `correct_index` so the
 * model reasons through the answer before committing to an index.
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
            explanation: { type: 'STRING' },
            correct_index: { type: 'INTEGER' },
          },
          required: ['kind', 'question', 'options', 'explanation', 'correct_index'],
          propertyOrdering: ['kind', 'question', 'options', 'explanation', 'correct_index'],
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

