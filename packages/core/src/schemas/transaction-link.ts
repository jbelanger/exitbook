import { z } from 'zod';

import { CurrencySchema, DecimalSchema } from './money.js';
import { DateSchema } from './primitives.js';

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
  assetSymbol: CurrencySchema,
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
 * Type exports inferred from schemas
 */
export type LinkType = z.infer<typeof LinkTypeSchema>;
export type LinkStatus = z.infer<typeof LinkStatusSchema>;
export type MatchCriteria = z.infer<typeof MatchCriteriaSchema>;
export type TransactionLinkMetadata = z.infer<typeof TransactionLinkMetadataSchema>;
export type TransactionLink = z.infer<typeof TransactionLinkSchema>;
