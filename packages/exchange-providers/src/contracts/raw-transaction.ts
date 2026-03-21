import { z } from 'zod';

/**
 * Schema for provider transaction DTOs emitted by exchange clients before persistence.
 */
export const RawTransactionInputSchema = z.object({
  providerName: z.string().min(1, 'Provider Name must not be empty'),
  sourceAddress: z.string().optional(),
  transactionTypeHint: z.string().optional(),
  eventId: z.string().min(1, 'Event ID must not be empty'),
  blockchainTransactionHash: z.string().optional(),
  timestamp: z.number().int().positive(),
  providerData: z.unknown(),
  normalizedData: z.unknown().optional(),
});

export type RawTransactionInput = z.infer<typeof RawTransactionInputSchema>;
