import { z } from 'zod';

/**
 * Zod schema for PaginationCursor (discriminated union)
 */
export const PaginationCursorSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('blockNumber'),
    value: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal('timestamp'),
    value: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal('txHash'),
    value: z.string().min(1),
  }),
  z.object({
    type: z.literal('slot'),
    value: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal('signature'),
    value: z.string().min(1),
  }),
  z.object({
    type: z.literal('pageToken'),
    value: z.string().min(1),
    providerName: z.string().min(1),
  }),
]);

/**
 * Zod schema for CursorState
 */
export const CursorStateSchema = z.object({
  primary: PaginationCursorSchema,
  alternatives: z.array(PaginationCursorSchema).optional(),
  lastTransactionId: z.string().min(1),
  totalFetched: z.number().int().nonnegative(),
  metadata: z
    .object({
      providerName: z.string(),
      updatedAt: z.number().int().nonnegative(),
      isComplete: z.boolean().optional(),
    })
    .passthrough() // Allow additional provider-specific metadata fields
    .optional(),
});
