import { CurrencySchema, DateSchema, DecimalSchema } from '@exitbook/foundation';
import { z } from 'zod';

import { OverrideLinkTypeSchema } from '../override/override.js';

import { MovementRoleSchema, type MovementRole } from './movement.js';

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
 * Provenance of a transaction link
 * - system: produced and finalized by the linker without user intervention
 * - user: produced by the linker, then confirmed/rejected by the user
 * - manual: created from an explicit user link override when the linker had no link
 */
export const TransactionLinkProvenanceSchema = z.enum(['system', 'user', 'manual']);

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
    sameHashExternalFeeAccounting: z.enum(['deduped_shared_fee', 'per_source_allocated_fee']).optional(),
    sameHashExternalTotalFee: z.string().optional(),
    dedupedSameHashFee: z.string().optional(),
    sameHashExternalGroupAmount: z.string().optional(),
    sameHashExternalGroupSize: z.number().int().positive().optional(),
    sameHashTrackedSiblingInflowAmount: z.string().optional(),
    sameHashTrackedSiblingInflowCount: z.number().int().positive().optional(),
    sameHashResidualAllocationPolicy: z.string().optional(),
    sameHashExplainedTargetResidualAmount: z.string().optional(),
    sameHashExplainedTargetResidualRole: MovementRoleSchema.optional(),
    feeBearingSourceTransactionId: z.number().int().positive().optional(),
    sameHashExternalSourceAllocations: z.array(SameHashExternalSourceAllocationSchema).optional(),
    sharedToAddress: z.string().optional(),
    counterpartyRoundtrip: z.literal(true).optional(),
    counterpartyRoundtripHours: z.string().optional(),
    transferProposalKey: z.string().optional(),
    overrideId: z.string().optional(),
    overrideLinkType: OverrideLinkTypeSchema.optional(),
    linkProvenance: TransactionLinkProvenanceSchema.optional(),
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
export type TransactionLinkProvenance = z.infer<typeof TransactionLinkProvenanceSchema>;
export type MatchCriteria = z.infer<typeof MatchCriteriaSchema>;

export type TransactionLinkScoreBreakdownEntry = z.infer<typeof TransactionLinkScoreBreakdownEntrySchema>;
export type SameHashExternalSourceAllocation = z.infer<typeof SameHashExternalSourceAllocationSchema>;
export type TransactionLinkMetadata = z.infer<typeof TransactionLinkMetadataSchema>;
export type TransactionLink = z.infer<typeof TransactionLinkSchema>;
export type NewTransactionLink = z.infer<typeof NewTransactionLinkSchema>;

export interface ExplainedTargetResidual {
  amount: z.infer<typeof DecimalSchema>;
  role: MovementRole;
}

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

export function resolveTransactionLinkProvenance(
  link: Pick<TransactionLink, 'metadata' | 'reviewedBy'>
): TransactionLinkProvenance {
  const persistedProvenance = link.metadata?.linkProvenance;
  if (persistedProvenance !== undefined) {
    return persistedProvenance;
  }

  if (link.reviewedBy === undefined || link.reviewedBy === 'auto') {
    return 'system';
  }

  return 'user';
}

export function isSameHashExternalLinkMetadata(
  metadata: TransactionLinkMetadata | undefined
): metadata is TransactionLinkMetadata &
  Required<
    Pick<
      TransactionLinkMetadata,
      | 'sameHashExternalGroup'
      | 'sameHashExternalGroupAmount'
      | 'sameHashExternalGroupSize'
      | 'sameHashExternalSourceAllocations'
      | 'blockchainTxHash'
      | 'sharedToAddress'
    >
  > {
  return (
    metadata?.sameHashExternalGroup === true &&
    typeof metadata.sameHashExternalGroupAmount === 'string' &&
    typeof metadata.sameHashExternalGroupSize === 'number' &&
    Array.isArray(metadata.sameHashExternalSourceAllocations) &&
    typeof metadata.blockchainTxHash === 'string' &&
    typeof metadata.sharedToAddress === 'string'
  );
}

export function getExplainedTargetResidual(
  links: readonly Pick<TransactionLink, 'metadata'>[]
): ExplainedTargetResidual | undefined {
  let resolvedAmount: z.infer<typeof DecimalSchema> | undefined;
  let resolvedRole: MovementRole | undefined;
  let explainedLinkCount = 0;

  for (const link of links) {
    const amountRaw = link.metadata?.sameHashExplainedTargetResidualAmount;
    const roleRaw = link.metadata?.sameHashExplainedTargetResidualRole;

    if (amountRaw === undefined && roleRaw === undefined) {
      continue;
    }

    if (typeof amountRaw !== 'string') {
      return undefined;
    }

    const parsedRole = MovementRoleSchema.safeParse(roleRaw);
    if (!parsedRole.success) {
      return undefined;
    }

    const parsedAmount = DecimalSchema.safeParse(amountRaw);
    if (!parsedAmount.success) {
      return undefined;
    }

    const amount = parsedAmount.data;
    if (resolvedAmount === undefined || resolvedRole === undefined) {
      resolvedAmount = amount;
      resolvedRole = parsedRole.data;
      explainedLinkCount += 1;
      continue;
    }

    if (!resolvedAmount.eq(amount) || resolvedRole !== parsedRole.data) {
      return undefined;
    }

    explainedLinkCount += 1;
  }

  if (explainedLinkCount === 0 || explainedLinkCount !== links.length || !resolvedAmount || !resolvedRole) {
    return undefined;
  }

  return {
    amount: resolvedAmount,
    role: resolvedRole,
  };
}
