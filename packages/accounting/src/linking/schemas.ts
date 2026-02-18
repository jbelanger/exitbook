import { DateSchema, DecimalSchema } from '@exitbook/core';
import { z } from 'zod';

const UnitIntervalDecimalSchema = DecimalSchema.refine(
  (value) => value.greaterThanOrEqualTo(0) && value.lessThanOrEqualTo(1),
  { message: 'Value must be between 0 and 1 (inclusive)' }
);

/**
 * Link type schema
 */
export const LinkTypeSchema = z.enum([
  'exchange_to_blockchain',
  'blockchain_to_blockchain',
  'exchange_to_exchange',
  'blockchain_internal',
]);

/**
 * Link status schema
 */
export const LinkStatusSchema = z.enum(['suggested', 'confirmed', 'rejected']);

/**
 * Match criteria schema
 */
export const MatchCriteriaSchema = z.object({
  assetMatch: z.boolean(),
  amountSimilarity: UnitIntervalDecimalSchema,
  timingValid: z.boolean(),
  timingHours: z.number(),
  addressMatch: z.boolean().optional(),
  hashMatch: z.boolean().optional(),
});

/**
 * Transaction link metadata schema
 */
export const TransactionLinkMetadataSchema = z.record(z.string(), z.unknown());

/**
 * Transaction link schema
 */
export const TransactionLinkSchema = z.object({
  id: z.string(),
  sourceTransactionId: z.number(),
  targetTransactionId: z.number(),
  assetSymbol: z.string(),
  sourceAssetId: z.string(),
  targetAssetId: z.string(),
  sourceAmount: DecimalSchema,
  targetAmount: DecimalSchema,
  linkType: LinkTypeSchema,
  confidenceScore: UnitIntervalDecimalSchema,
  matchCriteria: MatchCriteriaSchema,
  status: LinkStatusSchema,
  reviewedBy: z.string().optional(),
  reviewedAt: DateSchema.optional(),
  createdAt: DateSchema,
  updatedAt: DateSchema,
  metadata: TransactionLinkMetadataSchema.optional(),
});

/**
 * Transaction candidate schema
 */
export const TransactionCandidateSchema = z.object({
  id: z.number(),
  sourceName: z.string(),
  sourceType: z.enum(['exchange', 'blockchain']),
  externalId: z.string().optional(),
  timestamp: DateSchema,
  assetId: z.string(),
  assetSymbol: z.string(),
  amount: DecimalSchema,
  direction: z.enum(['in', 'out', 'neutral']),
  fromAddress: z.string().optional(),
  toAddress: z.string().optional(),
  blockchainTransactionHash: z.string().optional(),
});

/**
 * Potential match schema
 */
export const PotentialMatchSchema = z.object({
  sourceTransaction: TransactionCandidateSchema,
  targetTransaction: TransactionCandidateSchema,
  confidenceScore: UnitIntervalDecimalSchema,
  matchCriteria: MatchCriteriaSchema,
  linkType: LinkTypeSchema,
});

/**
 * Matching config schema
 */
export const MatchingConfigSchema = z.object({
  maxTimingWindowHours: z.number().positive(),
  minAmountSimilarity: DecimalSchema,
  minConfidenceScore: DecimalSchema,
  autoConfirmThreshold: DecimalSchema,
});

/**
 * Linking result schema
 */
export const LinkingResultSchema = z.object({
  suggestedLinks: z.array(PotentialMatchSchema),
  confirmedLinks: z.array(TransactionLinkSchema),
  totalSourceTransactions: z.number(),
  totalTargetTransactions: z.number(),
  matchedTransactionCount: z.number(),
  unmatchedSourceCount: z.number(),
  unmatchedTargetCount: z.number(),
});
