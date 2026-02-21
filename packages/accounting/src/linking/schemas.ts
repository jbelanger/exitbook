import {
  CurrencySchema,
  DateSchema,
  DecimalSchema,
  LinkStatusSchema,
  LinkTypeSchema,
  MatchCriteriaSchema,
  TransactionLinkMetadataSchema,
  TransactionLinkSchema,
} from '@exitbook/core';
import { z } from 'zod';

const UnitIntervalDecimalSchema = DecimalSchema.refine(
  (value) => value.greaterThanOrEqualTo(0) && value.lessThanOrEqualTo(1),
  { message: 'Value must be between 0 and 1 (inclusive)' }
);

/**
 * Shared transaction link schemas re-exported for accounting APIs
 */
export { LinkTypeSchema, LinkStatusSchema, MatchCriteriaSchema, TransactionLinkMetadataSchema, TransactionLinkSchema };

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
  assetSymbol: CurrencySchema,
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
