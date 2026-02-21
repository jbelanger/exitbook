import { z } from 'zod';

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
  assetId: z.string().optional(),
  assetSymbol: z.string(),
  calculated: z.string(),
  difference: z.string(),
  live: z.string(),
});

/**
 * Balance verification status schema - match/mismatch/unavailable states
 */
export const BalanceVerificationStatusSchema = z.enum(['match', 'mismatch', 'unavailable']);

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
 * Schema for verification metadata persisted on Account
 */
export const VerificationMetadataSchema = z.object({
  current_balance: z.record(z.string(), z.string()),
  last_verification: BalanceVerificationSchema,
  source_params: SourceParamsSchema,
});

/**
 * Type exports inferred from schemas
 */
export type SourceParams = z.infer<typeof SourceParamsSchema>;
export type BalanceDiscrepancy = z.infer<typeof BalanceDiscrepancySchema>;
export type BalanceVerificationStatus = z.infer<typeof BalanceVerificationStatusSchema>;
export type BalanceVerification = z.infer<typeof BalanceVerificationSchema>;
export type VerificationMetadata = z.infer<typeof VerificationMetadataSchema>;
