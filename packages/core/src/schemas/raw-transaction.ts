import { z } from 'zod';

import { DateSchema } from './money.js';

/**
 * Processing status schema for external transaction data lifecycle:
 * - 'pending': awaiting processing
 * - 'processed': successfully transformed to universal transaction
 */
export const ProcessingStatusSchema = z.enum(['pending', 'processed']);

/**
 * Schema for input DTO used by importers before persistence (write-side)
 */
export const RawTransactionInputSchema = z.object({
  providerName: z.string().min(1, 'Provider Name must not be empty'),
  sourceAddress: z.string().optional(),
  transactionTypeHint: z.string().optional(),
  eventId: z.string().min(1, 'Event ID must not be empty'),
  blockchainTransactionHash: z.string().optional(), // On-chain transaction hash for deduplication (blockchain only)
  timestamp: z.number().int().positive(), // Event timestamp in Unix milliseconds
  providerData: z.unknown(),
  normalizedData: z.unknown(),
});

/**
 * Schema for external transaction data after database persistence (read-side)
 * Extends base schema with database-specific fields
 */
export const RawTransactionSchema = RawTransactionInputSchema.extend({
  id: z.number().int().positive(),
  accountId: z.number().int().positive(),
  processingStatus: ProcessingStatusSchema,
  processedAt: DateSchema.optional(),
  createdAt: DateSchema,
});

export type ProcessingStatus = z.infer<typeof ProcessingStatusSchema>;
export type RawTransactionInput = z.infer<typeof RawTransactionInputSchema>;
export type RawTransaction = z.infer<typeof RawTransactionSchema>;
