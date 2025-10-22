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
 * Schema for import session metadata
 * Provides blockchain-specific address context and import details
 */
export const ImportSessionMetadataSchema = z
  .object({
    address: z.string().optional(),
    csvDirectories: z.array(z.string()).optional(),
    derivedAddresses: z.array(z.string()).optional(),
    importedAt: z.number().optional(),
    importParams: DataImportParamsSchema.optional(),
  })
  .catchall(z.unknown());

/**
 * Schema for import result metadata
 * Flexible structure for storing arbitrary import result data
 */
export const ImportResultMetadataSchema = z.record(z.string(), z.unknown());

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
 * Balance verification status schema - match/mismatch/unavailable states
 */
export const BalanceVerificationStatusSchema = z.enum(['match', 'mismatch', 'unavailable']);

/**
 * Balance command status schema - overall command result status
 */
export const BalanceCommandStatusSchema = z.enum(['success', 'warning', 'failed']);

/**
 * Schema for balance verification result
 */
export const BalanceVerificationSchema = z.object({
  calculated_balance: z.record(z.string(), z.string()),
  discrepancies: z.array(BalanceDiscrepancySchema).optional(),
  live_balance: z.record(z.string(), z.string()).optional(),
  status: BalanceVerificationStatusSchema,
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
 * Schema for data source domain model
 * Represents a complete import session with all metadata
 */
export const DataSourceSchema = z.object({
  id: z.number(),
  sourceId: z.string(),
  sourceType: SourceTypeSchema,
  status: DataSourceStatusSchema,
  startedAt: z.date(),
  completedAt: z.date().optional(),
  createdAt: z.date(),
  updatedAt: z.date().optional(),
  durationMs: z.number().optional(),
  errorMessage: z.string().optional(),
  errorDetails: z.unknown().optional(),
  importParams: DataImportParamsSchema,
  importResultMetadata: ImportResultMetadataSchema,
  lastBalanceCheckAt: z.date().optional(),
  verificationMetadata: VerificationMetadataSchema.optional(),
});

/**
 * Type exports inferred from schemas
 */
export type SourceType = z.infer<typeof SourceTypeSchema>;
export type DataSourceStatus = z.infer<typeof DataSourceStatusSchema>;
export type DataImportParams = z.infer<typeof DataImportParamsSchema>;
export type ImportSessionMetadata = z.infer<typeof ImportSessionMetadataSchema>;
export type ImportResultMetadata = z.infer<typeof ImportResultMetadataSchema>;
export type SourceParams = z.infer<typeof SourceParamsSchema>;
export type BalanceDiscrepancy = z.infer<typeof BalanceDiscrepancySchema>;
export type BalanceVerificationStatus = z.infer<typeof BalanceVerificationStatusSchema>;
export type BalanceCommandStatus = z.infer<typeof BalanceCommandStatusSchema>;
export type BalanceVerification = z.infer<typeof BalanceVerificationSchema>;
export type VerificationMetadata = z.infer<typeof VerificationMetadataSchema>;
export type DataSource = z.infer<typeof DataSourceSchema>;
