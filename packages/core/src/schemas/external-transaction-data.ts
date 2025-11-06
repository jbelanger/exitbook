import { z } from 'zod';

import { DateSchema } from './money.js';

/**
 * Processing status schema for external transaction data lifecycle
 */
export const ProcessingStatusSchema = z.enum(['pending', 'processed', 'failed', 'skipped']);

/**
 * Schema for input DTO used by importers before persistence (write-side)
 */
export const ExternalTransactionSchema = z.object({
  providerName: z.string().min(1, 'Provider Name must not be empty'),
  sourceAddress: z.string().optional(),
  transactionTypeHint: z.string().optional(),
  externalId: z.string().min(1, 'External ID must not be empty'),
  cursor: z.record(z.string(), z.unknown()).optional(),
  rawData: z.unknown(),
  normalizedData: z.unknown(),
});

/**
 * Schema for external transaction data after database persistence (read-side)
 * Extends base schema with database-specific fields
 */
export const ExternalTransactionDataSchema = ExternalTransactionSchema.extend({
  id: z.number().int().positive(),
  dataSourceId: z.number().int().positive(),
  processingStatus: ProcessingStatusSchema,
  processedAt: DateSchema.optional(),
  processingError: z.string().optional(),
  createdAt: DateSchema,
});

export type ProcessingStatus = z.infer<typeof ProcessingStatusSchema>;
export type ExternalTransaction = z.infer<typeof ExternalTransactionSchema>;
export type ExternalTransactionData = z.infer<typeof ExternalTransactionDataSchema>;
