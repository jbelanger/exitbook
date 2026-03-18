import { z } from 'zod';

import { CurrencySchema, DecimalSchema } from '../money/money.js';
import { OverrideLinkTypeSchema } from '../override/override.js';
import { DateSchema } from '../utils/primitives.js';

export const UnitIntervalDecimalSchema = DecimalSchema.refine(
  (value) => value.greaterThanOrEqualTo(0) && value.lessThanOrEqualTo(1),
  { message: 'Value must be between 0 and 1 (inclusive)' }
);

const NonNegativeDecimalSchema = DecimalSchema.refine((value) => value.greaterThanOrEqualTo(0), {
  message: 'Value must be non-negative',
});

/**
 * Type of transaction link
 * - exchange_to_blockchain: Exchange withdrawal → Blockchain deposit
 * - blockchain_to_exchange: Blockchain send → Exchange deposit
 * - blockchain_to_blockchain: Blockchain send → Blockchain receive
 * - exchange_to_exchange: Exchange withdrawal → Exchange deposit
 * - blockchain_internal: Same tx_hash, different tracked addresses (UTXO and account-model chains)
 */
export const LinkTypeSchema = z.enum([
  'exchange_to_blockchain',
  'blockchain_to_exchange',
  'blockchain_to_blockchain',
  'exchange_to_exchange',
  'blockchain_internal',
]);

/**
 * Status of a transaction link
 */
export const LinkStatusSchema = z.enum(['suggested', 'confirmed', 'rejected']);

/**
 * Criteria used for matching transactions
 * - assetMatch: Whether assets match
 * - amountSimilarity: 0-1, closer to 1 is better
 * - timingValid: Source before target, within window
 * - timingHours: Hours between transactions
 * - addressMatch: If we can match blockchain addresses (optional)
 */
export const MatchCriteriaSchema = z.object({
  assetMatch: z.boolean(),
  amountSimilarity: UnitIntervalDecimalSchema,
  timingValid: z.boolean(),
  timingHours: z.number(),
  suspectedMigration: z.boolean().optional(),
  addressMatch: z.boolean().optional(),
  hashMatch: z.boolean().optional(),
});

/**
 * Transaction link metadata schema
 */
export const TransactionLinkScoreBreakdownEntrySchema = z.object({
  signal: z.string(),
  weight: z.string(),
  value: z.string(),
  contribution: z.string(),
});

export const SameHashExternalSourceAllocationSchema = z.object({
  sourceTransactionId: z.number().int().positive(),
  grossAmount: z.string(),
  linkedAmount: z.string(),
  feeDeducted: z.string(),
  unlinkedAmount: z.string().optional(),
});

export const TransactionLinkMetadataSchema = z
  .object({
    variance: z.string().optional(),
    variancePct: z.string().optional(),
    partialMatch: z.literal(true).optional(),
    fullSourceAmount: z.string().optional(),
    fullTargetAmount: z.string().optional(),
    consumedAmount: z.string().optional(),
    targetExcessAllowed: z.literal(true).optional(),
    targetExcess: z.string().optional(),
    targetExcessPct: z.string().optional(),
    scoreBreakdown: z.array(TransactionLinkScoreBreakdownEntrySchema).optional(),
    blockchainTxHash: z.string().optional(),
    blockchain: z.string().optional(),
    sameHashExternalGroup: z.literal(true).optional(),
    sameHashMixedExternalGroup: z.literal(true).optional(),
    dedupedSameHashFee: z.string().optional(),
    sameHashExternalGroupAmount: z.string().optional(),
    sameHashExternalGroupSize: z.number().int().positive().optional(),
    sameHashTrackedSiblingInflowAmount: z.string().optional(),
    sameHashTrackedSiblingInflowCount: z.number().int().positive().optional(),
    sameHashResidualAllocationPolicy: z.string().optional(),
    feeBearingSourceTransactionId: z.number().int().positive().optional(),
    sameHashExternalSourceAllocations: z.array(SameHashExternalSourceAllocationSchema).optional(),
    sharedToAddress: z.string().optional(),
    transferProposalKey: z.string().optional(),
    overrideId: z.string().optional(),
    overrideLinkType: OverrideLinkTypeSchema.optional(),
  })
  .strict();

/**
 * Transaction link schema
 */
export const TransactionLinkSchema = z.object({
  id: z.number(),
  sourceTransactionId: z.number(),
  targetTransactionId: z.number(),
  assetSymbol: CurrencySchema,
  sourceAssetId: z.string(),
  targetAssetId: z.string(),
  sourceAmount: DecimalSchema,
  targetAmount: DecimalSchema,
  sourceMovementFingerprint: z.string(),
  targetMovementFingerprint: z.string(),
  linkType: LinkTypeSchema,
  confidenceScore: UnitIntervalDecimalSchema,
  impliedFeeAmount: NonNegativeDecimalSchema.optional(),
  matchCriteria: MatchCriteriaSchema,
  status: LinkStatusSchema,
  reviewedBy: z.string().optional(),
  reviewedAt: DateSchema.optional(),
  createdAt: DateSchema,
  updatedAt: DateSchema,
  metadata: TransactionLinkMetadataSchema.optional(),
});

/**
 * Schema for a link not yet persisted (no database-generated id).
 */
export const NewTransactionLinkSchema = TransactionLinkSchema.omit({ id: true });

/**
 * Type exports inferred from schemas
 */
export type LinkType = z.infer<typeof LinkTypeSchema>;
export type LinkStatus = z.infer<typeof LinkStatusSchema>;
export type MatchCriteria = z.infer<typeof MatchCriteriaSchema>;

export type TransactionLinkScoreBreakdownEntry = z.infer<typeof TransactionLinkScoreBreakdownEntrySchema>;
export type SameHashExternalSourceAllocation = z.infer<typeof SameHashExternalSourceAllocationSchema>;
export type TransactionLinkMetadata = z.infer<typeof TransactionLinkMetadataSchema>;
export type TransactionLink = z.infer<typeof TransactionLinkSchema>;
export type NewTransactionLink = z.infer<typeof NewTransactionLinkSchema>;

export function isPartialMatchLinkMetadata(
  metadata: TransactionLinkMetadata | undefined
): metadata is TransactionLinkMetadata &
  Required<Pick<TransactionLinkMetadata, 'partialMatch' | 'fullSourceAmount' | 'fullTargetAmount' | 'consumedAmount'>> {
  return (
    metadata?.partialMatch === true &&
    typeof metadata.fullSourceAmount === 'string' &&
    typeof metadata.fullTargetAmount === 'string' &&
    typeof metadata.consumedAmount === 'string'
  );
}

export function hasImpliedFeeAmount(
  link: Pick<TransactionLink, 'impliedFeeAmount'> | undefined
): link is Pick<TransactionLink, 'impliedFeeAmount'> & { impliedFeeAmount: z.infer<typeof NonNegativeDecimalSchema> } {
  return link?.impliedFeeAmount !== undefined;
}

export function isSameHashExternalLinkMetadata(
  metadata: TransactionLinkMetadata | undefined
): metadata is TransactionLinkMetadata &
  Required<
    Pick<
      TransactionLinkMetadata,
      | 'sameHashExternalGroup'
      | 'dedupedSameHashFee'
      | 'sameHashExternalGroupAmount'
      | 'sameHashExternalGroupSize'
      | 'feeBearingSourceTransactionId'
      | 'sameHashExternalSourceAllocations'
      | 'blockchainTxHash'
      | 'sharedToAddress'
    >
  > {
  return (
    metadata?.sameHashExternalGroup === true &&
    typeof metadata.dedupedSameHashFee === 'string' &&
    typeof metadata.sameHashExternalGroupAmount === 'string' &&
    typeof metadata.sameHashExternalGroupSize === 'number' &&
    typeof metadata.feeBearingSourceTransactionId === 'number' &&
    Array.isArray(metadata.sameHashExternalSourceAllocations) &&
    typeof metadata.blockchainTxHash === 'string' &&
    typeof metadata.sharedToAddress === 'string'
  );
}
