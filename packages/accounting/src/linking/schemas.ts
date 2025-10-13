import { Decimal } from 'decimal.js';
import { z } from 'zod';

/**
 * Zod schema for Decimal values stored as strings
 */
const DecimalSchema = z
  .string()
  .or(z.instanceof(Decimal))
  .transform((val) => (typeof val === 'string' ? new Decimal(val) : val));

/**
 * Link type schema
 */
export const LinkTypeSchema = z.enum(['exchange_to_blockchain', 'blockchain_to_blockchain', 'exchange_to_exchange']);

/**
 * Link status schema
 */
export const LinkStatusSchema = z.enum(['suggested', 'confirmed', 'rejected']);

/**
 * Match criteria schema
 */
export const MatchCriteriaSchema = z.object({
  assetMatch: z.boolean(),
  amountSimilarity: DecimalSchema,
  timingValid: z.boolean(),
  timingHours: z.number(),
  addressMatch: z.boolean().optional(),
});

/**
 * Transaction link schema
 */
export const TransactionLinkSchema = z.object({
  id: z.string(),
  sourceTransactionId: z.number(),
  targetTransactionId: z.number(),
  linkType: LinkTypeSchema,
  confidenceScore: DecimalSchema,
  matchCriteria: MatchCriteriaSchema,
  status: LinkStatusSchema,
  reviewedBy: z.string().optional(),
  reviewedAt: z.date().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Transaction candidate schema
 */
export const TransactionCandidateSchema = z.object({
  id: z.number(),
  sourceId: z.string(),
  sourceType: z.enum(['exchange', 'blockchain']),
  externalId: z.string().optional(),
  timestamp: z.date(),
  asset: z.string(),
  amount: DecimalSchema,
  direction: z.enum(['in', 'out', 'neutral']),
  fromAddress: z.string().optional(),
  toAddress: z.string().optional(),
});

/**
 * Potential match schema
 */
export const PotentialMatchSchema = z.object({
  sourceTransaction: TransactionCandidateSchema,
  targetTransaction: TransactionCandidateSchema,
  confidenceScore: DecimalSchema,
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
  matchedCount: z.number(),
  unmatchedSourceCount: z.number(),
  unmatchedTargetCount: z.number(),
});
