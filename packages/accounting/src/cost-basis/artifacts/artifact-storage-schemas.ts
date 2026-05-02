import { CurrencySchema } from '@exitbook/foundation';
import {
  AccountingJournalKindSchema,
  AccountingJournalRelationshipKindSchema,
  AccountingPostingRoleSchema,
  AccountingRelationshipAllocationSideSchema,
} from '@exitbook/ledger';
import { z } from 'zod';

import {
  StoredCanadaCostBasisArtifactSchema,
  StoredCanadaDebugSchema,
} from '../jurisdictions/canada/artifacts/canada-artifact-codec.js';

import {
  DecimalStringSchema,
  IsoDateTimeStringSchema,
  StoredCostBasisExecutionMetaSchema,
  type CostBasisArtifactDebugPayload,
} from './artifact-storage-shared.js';

export { StoredCanadaCostBasisArtifactSchema };
export type { CostBasisArtifactDebugPayload };

export const StoredCostBasisConfigSchema = z.object({
  method: z.enum(['fifo', 'lifo', 'specific-id', 'average-cost']),
  currency: z.enum(['USD', 'CAD', 'EUR', 'GBP']),
  jurisdiction: z.enum(['CA', 'US', 'UK', 'EU']),
  taxYear: z.number().int().min(2000).max(2100),
  startDate: IsoDateTimeStringSchema,
  endDate: IsoDateTimeStringSchema,
  specificLotSelectionStrategy: z.enum(['minimize-gain', 'maximize-loss']).optional(),
});

export const StoredCostBasisCalculationSchema = z.object({
  id: z.string().uuid(),
  calculationDate: IsoDateTimeStringSchema,
  config: StoredCostBasisConfigSchema,
  startDate: IsoDateTimeStringSchema,
  endDate: IsoDateTimeStringSchema,
  totalProceeds: DecimalStringSchema,
  totalCostBasis: DecimalStringSchema,
  totalGainLoss: DecimalStringSchema,
  totalTaxableGainLoss: DecimalStringSchema,
  assetsProcessed: z.array(z.string().min(1)),
  transactionsProcessed: z.number().int().nonnegative(),
  lotsCreated: z.number().int().nonnegative(),
  disposalsProcessed: z.number().int().nonnegative(),
  status: z.enum(['pending', 'completed', 'failed']),
  errorMessage: z.string().optional(),
  createdAt: IsoDateTimeStringSchema,
  completedAt: IsoDateTimeStringSchema.optional(),
});

export const StoredAcquisitionLotSchema = z.object({
  id: z.string().uuid(),
  calculationId: z.string().uuid(),
  acquisitionTransactionId: z.number().int().positive(),
  assetId: z.string().min(1),
  assetSymbol: z.string().min(1),
  quantity: DecimalStringSchema,
  costBasisPerUnit: DecimalStringSchema,
  totalCostBasis: DecimalStringSchema,
  acquisitionDate: IsoDateTimeStringSchema,
  method: z.enum(['fifo', 'lifo', 'specific-id', 'average-cost']),
  remainingQuantity: DecimalStringSchema,
  status: z.enum(['open', 'partially_disposed', 'fully_disposed']),
  createdAt: IsoDateTimeStringSchema,
  updatedAt: IsoDateTimeStringSchema,
});

export const StoredLotDisposalSchema = z.object({
  id: z.string().uuid(),
  lotId: z.string().uuid(),
  disposalTransactionId: z.number().int().positive(),
  quantityDisposed: DecimalStringSchema,
  proceedsPerUnit: DecimalStringSchema,
  totalProceeds: DecimalStringSchema,
  grossProceeds: DecimalStringSchema,
  sellingExpenses: DecimalStringSchema,
  netProceeds: DecimalStringSchema,
  costBasisPerUnit: DecimalStringSchema,
  totalCostBasis: DecimalStringSchema,
  gainLoss: DecimalStringSchema,
  disposalDate: IsoDateTimeStringSchema,
  holdingPeriodDays: z.number().int().nonnegative(),
  lossDisallowed: z.boolean().optional(),
  disallowedLossAmount: DecimalStringSchema.optional(),
  taxTreatmentCategory: z.string().optional(),
  createdAt: IsoDateTimeStringSchema,
});

export const StoredLotTransferMetadataSchema = z
  .object({
    sameAssetFeeUsdValue: DecimalStringSchema.optional(),
  })
  .optional();

export const StoredLotTransferProvenanceSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('confirmed-link'),
    linkId: z.number().int().positive(),
    sourceMovementFingerprint: z.string().min(1),
    targetMovementFingerprint: z.string().min(1),
  }),
  z.object({
    kind: z.literal('internal-transfer-carryover'),
    sourceMovementFingerprint: z.string().min(1),
    targetMovementFingerprint: z.string().min(1),
  }),
]);

export const StoredLotTransferSchema = z.object({
  id: z.string().uuid(),
  calculationId: z.string().uuid(),
  sourceLotId: z.string().uuid(),
  provenance: StoredLotTransferProvenanceSchema,
  quantityTransferred: DecimalStringSchema,
  costBasisPerUnit: DecimalStringSchema,
  sourceTransactionId: z.number().int().positive(),
  targetTransactionId: z.number().int().positive(),
  transferDate: IsoDateTimeStringSchema,
  createdAt: IsoDateTimeStringSchema,
  metadata: StoredLotTransferMetadataSchema,
});

export const StoredFxConversionSchema = z.object({
  originalCurrency: z.string().min(1),
  displayCurrency: z.string().min(1),
  fxRate: DecimalStringSchema,
  fxSource: z.string().min(1),
  fxFetchedAt: IsoDateTimeStringSchema,
});

export const StoredConvertedAcquisitionLotSchema = StoredAcquisitionLotSchema.extend({
  displayCostBasisPerUnit: DecimalStringSchema,
  displayTotalCostBasis: DecimalStringSchema,
  fxConversion: StoredFxConversionSchema,
  fxUnavailable: z.literal(true).optional(),
  originalCurrency: z.string().min(1).optional(),
});

export const StoredConvertedLotDisposalSchema = StoredLotDisposalSchema.extend({
  displayProceedsPerUnit: DecimalStringSchema,
  displayTotalProceeds: DecimalStringSchema,
  displayCostBasisPerUnit: DecimalStringSchema,
  displayTotalCostBasis: DecimalStringSchema,
  displayGainLoss: DecimalStringSchema,
  fxConversion: StoredFxConversionSchema,
});

export const StoredConvertedLotTransferSchema = StoredLotTransferSchema.extend({
  displayCostBasisPerUnit: DecimalStringSchema,
  displayTotalCostBasis: DecimalStringSchema,
  fxConversion: StoredFxConversionSchema,
  fxUnavailable: z.literal(true).optional(),
  originalCurrency: z.string().min(1).optional(),
});

export const StoredCostBasisReportSchema = z.object({
  calculationId: z.string().uuid(),
  displayCurrency: z.string().min(1),
  originalCurrency: z.string().min(1),
  disposals: z.array(StoredConvertedLotDisposalSchema),
  lots: z.array(StoredConvertedAcquisitionLotSchema),
  lotTransfers: z.array(StoredConvertedLotTransferSchema),
  summary: z.object({
    totalCostBasis: DecimalStringSchema,
    totalGainLoss: DecimalStringSchema,
    totalProceeds: DecimalStringSchema,
    totalTaxableGainLoss: DecimalStringSchema,
  }),
  originalSummary: z.object({
    totalCostBasis: DecimalStringSchema,
    totalGainLoss: DecimalStringSchema,
    totalProceeds: DecimalStringSchema,
    totalTaxableGainLoss: DecimalStringSchema,
  }),
});

export const StoredStandardCostBasisArtifactSchema = z.object({
  kind: z.literal('standard-workflow'),
  calculation: StoredCostBasisCalculationSchema,
  lotsCreated: z.number().int().nonnegative(),
  disposalsProcessed: z.number().int().nonnegative(),
  totalCapitalGainLoss: DecimalStringSchema,
  totalTaxableGainLoss: DecimalStringSchema,
  assetsProcessed: z.array(z.string().min(1)),
  lots: z.array(StoredAcquisitionLotSchema),
  disposals: z.array(StoredLotDisposalSchema),
  lotTransfers: z.array(StoredLotTransferSchema),
  executionMeta: StoredCostBasisExecutionMetaSchema,
  report: StoredCostBasisReportSchema.optional(),
});

export const StoredStandardLedgerCostBasisCalculationSchema = z.object({
  id: z.string().min(1),
  calculationDate: IsoDateTimeStringSchema,
  config: StoredCostBasisConfigSchema,
  startDate: IsoDateTimeStringSchema,
  endDate: IsoDateTimeStringSchema,
  totalProceeds: DecimalStringSchema,
  totalCostBasis: DecimalStringSchema,
  totalGainLoss: DecimalStringSchema,
  totalTaxableGainLoss: DecimalStringSchema,
  assetsProcessed: z.array(z.string().min(1)),
  eventsProjected: z.number().int().nonnegative(),
  operationsProcessed: z.number().int().nonnegative(),
  lotsCreated: z.number().int().nonnegative(),
  disposalsProcessed: z.number().int().nonnegative(),
  blockersProduced: z.number().int().nonnegative(),
  status: z.enum(['completed', 'failed']),
  errorMessage: z.string().optional(),
  createdAt: IsoDateTimeStringSchema,
  completedAt: IsoDateTimeStringSchema.optional(),
});

const StoredStandardLedgerBasisStatusSchema = z.enum(['priced', 'unresolved']);
const StoredLedgerPostingBlockerReasonSchema = z.enum([
  'cost_settlement_missing',
  'missing_relationship',
  'relationship_residual',
  'unsupported_protocol_posting',
  'zero_quantity_posting',
]);
const StoredLedgerRelationshipBlockerReasonSchema = z.enum([
  'relationship_allocation_invalid',
  'relationship_allocation_missing_posting',
  'relationship_allocation_overallocated',
  'relationship_allocation_posting_mismatch',
  'relationship_partially_excluded',
]);
const StoredLedgerProjectionBlockerReasonSchema = z.union([
  StoredLedgerPostingBlockerReasonSchema,
  StoredLedgerRelationshipBlockerReasonSchema,
]);
const StoredLedgerRelationshipAllocationBlockerStateSchema = z.enum([
  'blocked_by_relationship',
  'excluded_posting',
  'invalid_allocation',
  'mismatched_posting',
  'missing_posting',
  'overallocated_posting',
]);
const StoredLedgerRelationshipAllocationMismatchReasonSchema = z.enum([
  'asset_id_mismatch',
  'asset_symbol_mismatch',
  'current_journal_id_mismatch',
  'current_posting_id_mismatch',
  'journal_fingerprint_mismatch',
  'source_activity_fingerprint_mismatch',
]);
const StoredLedgerRelationshipAllocationValidationReasonSchema = z.enum([
  'non_positive_quantity',
  'overallocated_posting',
  'protocol_position_requires_carry_basis_relationship',
  'relationship_allocation_points_at_fee_posting',
  'relationship_allocation_points_at_protocol_overhead_posting',
  'source_allocation_points_at_positive_posting',
  'target_allocation_points_at_negative_posting',
]);
const StoredLedgerOperationBlockerReasonSchema = z.union([
  StoredLedgerProjectionBlockerReasonSchema,
  z.enum([
    'carry_relationship_context_missing',
    'carry_relationship_leg_missing',
    'fee_journal_context_missing',
    'fee_settlement_missing',
    'fiat_cost_basis_event',
    'relationship_context_incomplete',
    'tax_asset_identity_unresolved',
  ]),
]);
const StoredStandardLedgerCalculationBlockerReasonSchema = z.enum([
  'chain_fenced',
  'fee_treatment_unimplemented',
  'insufficient_lots',
  'missing_disposal_price',
  'same_chain_carry_quantity_mismatch',
  'unknown_fee_attachment',
  'unresolved_basis_disposal',
  'unsupported_strategy',
  'upstream_operation_blocker',
]);

const StoredStandardLedgerRelationshipBasisTreatmentSchema = z.enum(['carry_basis', 'dispose_and_acquire']);

const StoredStandardLedgerRelationshipContextSchema = z.object({
  relationshipStableKey: z.string().min(1),
  relationshipKind: AccountingJournalRelationshipKindSchema,
  relationshipBasisTreatment: StoredStandardLedgerRelationshipBasisTreatmentSchema,
  relationshipAllocationId: z.number().int().positive(),
});

const StoredStandardLedgerPostingProvenanceSchema = z.object({
  sourceEventId: z.string().min(1),
  sourceActivityFingerprint: z.string().min(1),
  ownerAccountId: z.number().int().positive(),
  journalFingerprint: z.string().min(1),
  journalKind: AccountingJournalKindSchema,
  postingFingerprint: z.string().min(1),
  postingRole: AccountingPostingRoleSchema,
  relationshipContext: StoredStandardLedgerRelationshipContextSchema.optional(),
});

const StoredStandardLedgerLotProvenanceSchema = z.discriminatedUnion('kind', [
  StoredStandardLedgerPostingProvenanceSchema.extend({
    kind: z.literal('acquire-operation'),
    operationId: z.string().min(1),
  }),
  StoredStandardLedgerPostingProvenanceSchema.extend({
    kind: z.literal('carry-operation'),
    operationId: z.string().min(1),
    relationshipStableKey: z.string().min(1),
    relationshipKind: AccountingJournalRelationshipKindSchema,
    relationshipBasisTreatment: z.literal('carry_basis'),
    relationshipAllocationId: z.number().int().positive(),
    sourceLotId: z.string().min(1),
  }),
]);

const StoredStandardLedgerDisposalProvenanceSchema = StoredStandardLedgerPostingProvenanceSchema.extend({
  kind: z.literal('dispose-operation'),
  operationId: z.string().min(1),
});

export const StoredStandardLedgerLotSchema = z.object({
  id: z.string().min(1),
  calculationId: z.string().min(1),
  chainKey: z.string().min(1),
  assetId: z.string().min(1),
  assetSymbol: CurrencySchema,
  basisStatus: StoredStandardLedgerBasisStatusSchema,
  costBasisPerUnit: DecimalStringSchema.optional(),
  totalCostBasis: DecimalStringSchema.optional(),
  originalQuantity: DecimalStringSchema,
  remainingQuantity: DecimalStringSchema,
  acquisitionDate: IsoDateTimeStringSchema,
  provenance: StoredStandardLedgerLotProvenanceSchema,
});

export const StoredStandardLedgerLotSelectionSliceSchema = z.object({
  lotId: z.string().min(1),
  quantity: DecimalStringSchema,
  acquisitionDate: IsoDateTimeStringSchema,
  basisStatus: StoredStandardLedgerBasisStatusSchema,
  costBasis: DecimalStringSchema.optional(),
  costBasisPerUnit: DecimalStringSchema.optional(),
});

export const StoredStandardLedgerDisposalSchema = z.object({
  id: z.string().min(1),
  calculationId: z.string().min(1),
  operationId: z.string().min(1),
  chainKey: z.string().min(1),
  assetId: z.string().min(1),
  assetSymbol: CurrencySchema,
  quantity: DecimalStringSchema,
  grossProceeds: DecimalStringSchema,
  costBasis: DecimalStringSchema,
  gainLoss: DecimalStringSchema,
  disposalDate: IsoDateTimeStringSchema,
  provenance: StoredStandardLedgerDisposalProvenanceSchema,
  slices: z.array(StoredStandardLedgerLotSelectionSliceSchema),
});

export const StoredStandardLedgerCarrySliceSchema = z.object({
  sourceChainKey: z.string().min(1),
  sourceLotId: z.string().min(1).optional(),
  sourceQuantity: DecimalStringSchema,
  targetChainKey: z.string().min(1),
  targetLotId: z.string().min(1).optional(),
  targetQuantity: DecimalStringSchema,
  basisStatus: StoredStandardLedgerBasisStatusSchema,
  costBasis: DecimalStringSchema.optional(),
});

export const StoredStandardLedgerCarryLegSchema = z.object({
  allocationId: z.number().int().positive(),
  sourceEventId: z.string().min(1),
  timestamp: IsoDateTimeStringSchema,
  sourceActivityFingerprint: z.string().min(1),
  ownerAccountId: z.number().int().positive(),
  journalFingerprint: z.string().min(1),
  journalKind: AccountingJournalKindSchema,
  postingFingerprint: z.string().min(1),
  postingRole: AccountingPostingRoleSchema,
  chainKey: z.string().min(1),
  assetId: z.string().min(1),
  assetSymbol: CurrencySchema,
  quantity: DecimalStringSchema,
});

export const StoredStandardLedgerCarrySchema = z.object({
  id: z.string().min(1),
  calculationId: z.string().min(1),
  operationId: z.string().min(1),
  kind: z.enum(['cross-chain', 'same-chain']),
  relationshipKind: AccountingJournalRelationshipKindSchema,
  relationshipStableKey: z.string().min(1),
  slices: z.array(StoredStandardLedgerCarrySliceSchema),
  sourceLegs: z.array(StoredStandardLedgerCarryLegSchema),
  targetLegs: z.array(StoredStandardLedgerCarryLegSchema),
});

const StoredLedgerProjectionPostingBlockerSchema = z.object({
  scope: z.literal('posting'),
  reason: StoredLedgerPostingBlockerReasonSchema,
  sourceActivityFingerprint: z.string().min(1),
  journalFingerprint: z.string().min(1),
  postingFingerprint: z.string().min(1),
  assetId: z.string().min(1),
  assetSymbol: CurrencySchema,
  postingQuantity: DecimalStringSchema,
  blockedQuantity: DecimalStringSchema,
  relationshipStableKeys: z.array(z.string().min(1)),
  message: z.string().min(1),
});

const StoredLedgerRelationshipBlockerAllocationSchema = z.object({
  allocationId: z.number().int().positive(),
  allocationSide: AccountingRelationshipAllocationSideSchema,
  postingFingerprint: z.string().min(1),
  assetId: z.string().min(1),
  assetSymbol: CurrencySchema,
  quantity: DecimalStringSchema,
  state: StoredLedgerRelationshipAllocationBlockerStateSchema,
  mismatchReasons: z.array(StoredLedgerRelationshipAllocationMismatchReasonSchema),
  validationReasons: z.array(StoredLedgerRelationshipAllocationValidationReasonSchema),
});

const StoredLedgerProjectionRelationshipBlockerSchema = z.object({
  scope: z.literal('relationship'),
  reason: StoredLedgerRelationshipBlockerReasonSchema,
  relationshipStableKey: z.string().min(1),
  relationshipKind: AccountingJournalRelationshipKindSchema,
  allocations: z.array(StoredLedgerRelationshipBlockerAllocationSchema),
  message: z.string().min(1),
});

export const StoredLedgerProjectionBlockerSchema = z.discriminatedUnion('scope', [
  StoredLedgerProjectionPostingBlockerSchema,
  StoredLedgerProjectionRelationshipBlockerSchema,
]);

export const StoredLedgerOperationBlockerSchema = z.object({
  blockerId: z.string().min(1),
  reason: StoredLedgerOperationBlockerReasonSchema,
  propagation: z.enum(['op-only', 'after-fence']),
  affectedChainKeys: z.array(z.string().min(1)),
  inputEventIds: z.array(z.string().min(1)),
  sourceProjectionBlocker: StoredLedgerProjectionBlockerSchema.optional(),
  message: z.string().min(1),
});

export const StoredStandardLedgerCalculationBlockerSchema = z.object({
  blockerId: z.string().min(1),
  reason: StoredStandardLedgerCalculationBlockerReasonSchema,
  propagation: z.enum(['op-only', 'after-fence']),
  affectedChainKeys: z.array(z.string().min(1)),
  inputEventIds: z.array(z.string().min(1)),
  inputOperationIds: z.array(z.string().min(1)),
  message: z.string().min(1),
  sourceOperationBlocker: StoredLedgerOperationBlockerSchema.optional(),
});

export const StoredStandardLedgerOperationEngineResultSchema = z.object({
  lots: z.array(StoredStandardLedgerLotSchema),
  disposals: z.array(StoredStandardLedgerDisposalSchema),
  carries: z.array(StoredStandardLedgerCarrySchema),
  blockers: z.array(StoredStandardLedgerCalculationBlockerSchema),
});

export const StoredStandardLedgerExcludedPostingSchema = z.object({
  reason: z.literal('asset_excluded'),
  sourceActivityFingerprint: z.string().min(1),
  journalFingerprint: z.string().min(1),
  postingFingerprint: z.string().min(1),
  assetId: z.string().min(1),
  assetSymbol: CurrencySchema,
  postingQuantity: DecimalStringSchema,
  message: z.string().min(1),
});

export const StoredStandardLedgerProjectionAuditSchema = z.object({
  eventIds: z.array(z.string().min(1)),
  operationIds: z.array(z.string().min(1)),
  projectionBlockers: z.array(StoredLedgerProjectionBlockerSchema),
  operationBlockers: z.array(StoredLedgerOperationBlockerSchema),
  excludedPostings: z.array(StoredStandardLedgerExcludedPostingSchema),
  exclusionFingerprint: z.string().min(1),
});

export const StoredStandardLedgerCostBasisExecutionMetaSchema = z.object({
  calculationBlockerIds: z.array(z.string().min(1)),
  eventIds: z.array(z.string().min(1)),
  excludedPostingFingerprints: z.array(z.string().min(1)),
  exclusionFingerprint: z.string().min(1),
  operationBlockerIds: z.array(z.string().min(1)),
  operationIds: z.array(z.string().min(1)),
  projectionBlockerMessages: z.array(z.string().min(1)),
});

export const StoredStandardLedgerCostBasisArtifactSchema = z.object({
  kind: z.literal('standard-ledger-workflow'),
  calculation: StoredStandardLedgerCostBasisCalculationSchema,
  projection: StoredStandardLedgerProjectionAuditSchema,
  engineResult: StoredStandardLedgerOperationEngineResultSchema,
  executionMeta: StoredStandardLedgerCostBasisExecutionMetaSchema,
});

export const StoredStandardDebugSchema = z.object({
  kind: z.literal('standard-workflow'),
  inputTransactionIds: z.array(z.number().int().positive()),
  appliedConfirmedLinkIds: z.array(z.number().int().positive()),
});

export const StoredCostBasisDebugSchema = z.discriminatedUnion('kind', [
  StoredStandardDebugSchema,
  StoredCanadaDebugSchema,
]);

export const StoredArtifactEnvelopeBaseSchema = z.object({
  storageSchemaVersion: z.number().int().positive(),
  calculationEngineVersion: z.number().int().positive(),
  scopeKey: z.string().min(1),
  snapshotId: z.string().uuid(),
  calculationId: z.string().min(1),
  createdAt: IsoDateTimeStringSchema,
});

export const StoredCostBasisArtifactEnvelopeSchema = z.discriminatedUnion('artifactKind', [
  StoredArtifactEnvelopeBaseSchema.extend({
    artifactKind: z.literal('standard'),
    artifact: StoredStandardCostBasisArtifactSchema,
    debug: StoredStandardDebugSchema,
  }),
  StoredArtifactEnvelopeBaseSchema.extend({
    artifactKind: z.literal('canada'),
    artifact: StoredCanadaCostBasisArtifactSchema,
    debug: StoredCanadaDebugSchema,
  }),
]);

export type StoredCostBasisConfig = z.infer<typeof StoredCostBasisConfigSchema>;
export type StoredCostBasisCalculation = z.infer<typeof StoredCostBasisCalculationSchema>;
export type StoredAcquisitionLot = z.infer<typeof StoredAcquisitionLotSchema>;
export type StoredLotDisposal = z.infer<typeof StoredLotDisposalSchema>;
export type StoredLotTransfer = z.infer<typeof StoredLotTransferSchema>;
export type StoredFxConversion = z.infer<typeof StoredFxConversionSchema>;
export type StoredCostBasisReport = z.infer<typeof StoredCostBasisReportSchema>;
export type StoredStandardArtifact = z.infer<typeof StoredStandardCostBasisArtifactSchema>;
export type StoredStandardLedgerArtifact = z.infer<typeof StoredStandardLedgerCostBasisArtifactSchema>;
export type StoredStandardDebug = z.infer<typeof StoredStandardDebugSchema>;
export type StoredCostBasisDebug = z.infer<typeof StoredCostBasisDebugSchema>;
export type StoredArtifactEnvelope = z.infer<typeof StoredCostBasisArtifactEnvelopeSchema>;
