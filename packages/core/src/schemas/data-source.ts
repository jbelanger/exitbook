import { z } from 'zod';

/**
 * Source type schema - blockchain or exchange
 */
export const SourceTypeSchema = z.enum(['blockchain', 'exchange']);

/**
 * Data source status schema - lifecycle states for import sessions
 */
export const DataSourceStatusSchema = z.enum(['started', 'completed', 'failed', 'cancelled']);

/**
 * Schema for import parameters stored in session metadata
 */
export const DataImportParamsSchema = z.object({
  address: z.string().optional(),
  csvDirectories: z.array(z.string()).optional(),
  exchangeCredentials: z.record(z.string(), z.unknown()).optional(),
  providerId: z.string().optional(),
});

/**
 * Schema for source parameters identifying the wallet/account
 */
export const SourceParamsSchema = z.union([
  z.object({
    exchange: z.string(),
  }),
  z.object({
    blockchain: z.string(),
    address: z.string(),
  }),
]);

/**
 * Schema for balance discrepancy details
 */
export const BalanceDiscrepancySchema = z.object({
  asset: z.string(),
  calculated: z.string(),
  difference: z.string(),
  live: z.string(),
});

/**
 * Schema for balance verification result
 */
export const BalanceVerificationSchema = z.object({
  calculated_balance: z.record(z.string(), z.string()),
  discrepancies: z.array(BalanceDiscrepancySchema).optional(),
  live_balance: z.record(z.string(), z.string()).optional(),
  status: z.enum(['match', 'mismatch', 'unavailable']),
  suggestions: z.array(z.string()).optional(),
  verified_at: z.string(),
});

/**
 * Schema for verification metadata stored in session
 */
export const VerificationMetadataSchema = z.object({
  current_balance: z.record(z.string(), z.string()),
  last_verification: BalanceVerificationSchema,
  source_params: SourceParamsSchema,
});

/**
 * Type exports inferred from schemas
 */
export type SourceType = z.infer<typeof SourceTypeSchema>;
export type DataSourceStatus = z.infer<typeof DataSourceStatusSchema>;
export type DataImportParams = z.infer<typeof DataImportParamsSchema>;
export type SourceParams = z.infer<typeof SourceParamsSchema>;
export type BalanceDiscrepancy = z.infer<typeof BalanceDiscrepancySchema>;
export type BalanceVerification = z.infer<typeof BalanceVerificationSchema>;
export type VerificationMetadata = z.infer<typeof VerificationMetadataSchema>;
