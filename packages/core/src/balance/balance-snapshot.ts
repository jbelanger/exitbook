import { z } from 'zod';

export const BalanceSnapshotVerificationStatusSchema = z.enum([
  'never-run',
  'match',
  'warning',
  'mismatch',
  'unavailable',
]);

export const BalanceSnapshotCoverageStatusSchema = z.enum(['complete', 'partial']);

export const BalanceSnapshotCoverageConfidenceSchema = z.enum(['high', 'medium', 'low']);

export const BalanceSnapshotAssetComparisonStatusSchema = z.enum(['match', 'warning', 'mismatch', 'unavailable']);

export const BalanceSnapshotSchema = z.object({
  scopeAccountId: z.number().int().positive(),
  calculatedAt: z.date().optional(),
  lastRefreshAt: z.date().optional(),
  verificationStatus: BalanceSnapshotVerificationStatusSchema,
  coverageStatus: BalanceSnapshotCoverageStatusSchema.optional(),
  coverageConfidence: BalanceSnapshotCoverageConfidenceSchema.optional(),
  requestedAddressCount: z.number().int().nonnegative().optional(),
  successfulAddressCount: z.number().int().nonnegative().optional(),
  failedAddressCount: z.number().int().nonnegative().optional(),
  totalAssetCount: z.number().int().nonnegative().optional(),
  parsedAssetCount: z.number().int().nonnegative().optional(),
  failedAssetCount: z.number().int().nonnegative().optional(),
  matchCount: z.number().int().nonnegative(),
  warningCount: z.number().int().nonnegative(),
  mismatchCount: z.number().int().nonnegative(),
  statusReason: z.string().min(1).optional(),
  suggestion: z.string().min(1).optional(),
  lastError: z.string().min(1).optional(),
});

export const BalanceSnapshotAssetSchema = z.object({
  scopeAccountId: z.number().int().positive(),
  assetId: z.string().min(1),
  assetSymbol: z.string().min(1),
  calculatedBalance: z.string().min(1),
  liveBalance: z.string().min(1).optional(),
  difference: z.string().min(1).optional(),
  comparisonStatus: BalanceSnapshotAssetComparisonStatusSchema.optional(),
  excludedFromAccounting: z.boolean(),
});

export type BalanceSnapshotVerificationStatus = z.infer<typeof BalanceSnapshotVerificationStatusSchema>;
export type BalanceSnapshotCoverageStatus = z.infer<typeof BalanceSnapshotCoverageStatusSchema>;
export type BalanceSnapshotCoverageConfidence = z.infer<typeof BalanceSnapshotCoverageConfidenceSchema>;
export type BalanceSnapshotAssetComparisonStatus = z.infer<typeof BalanceSnapshotAssetComparisonStatusSchema>;
export type BalanceSnapshot = z.infer<typeof BalanceSnapshotSchema>;
export type BalanceSnapshotAsset = z.infer<typeof BalanceSnapshotAssetSchema>;
