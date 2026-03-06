import { z } from 'zod';

/**
 * Source type schema - blockchain or exchange
 */
export const SourceTypeSchema = z.enum(['blockchain', 'exchange']);

/**
 * Import Session status schema - lifecycle states
 */
export const ImportSessionStatusSchema = z.enum(['started', 'completed', 'failed', 'cancelled']);

/**
 * Schema for import session domain model
 * Represents a single import session execution (import_sessions table)
 * Links to accounts table via accountId - source info lives in the account
 */
export const ImportSessionSchema = z.object({
  id: z.number(),
  accountId: z.number(),
  status: ImportSessionStatusSchema,
  startedAt: z.date(),
  completedAt: z.date().optional(),
  durationMs: z.number().optional(),
  transactionsImported: z.number(),
  transactionsSkipped: z.number(),
  errorMessage: z.string().optional(),
  errorDetails: z.unknown().optional(),
  createdAt: z.date(),
  updatedAt: z.date().optional(),
});

/**
 * Type exports inferred from schemas
 */
export type SourceType = z.infer<typeof SourceTypeSchema>;
export type ImportSessionStatus = z.infer<typeof ImportSessionStatusSchema>;
export type ImportSession = z.infer<typeof ImportSessionSchema>;
