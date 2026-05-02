export type { FiatCurrency } from './cost-basis/model/cost-basis-config.js';
export { getDefaultDateRange } from './cost-basis/model/cost-basis-config.js';
export type { CostBasisJurisdiction, CostBasisMethod } from './cost-basis/jurisdictions/jurisdiction-configs.js';
export {
  getDefaultCostBasisCurrencyForJurisdiction,
  getDefaultCostBasisMethodForJurisdiction,
  listCostBasisJurisdictionCapabilities,
  listCostBasisMethodCapabilitiesForJurisdiction,
  SUPPORTED_COST_BASIS_FIAT_CURRENCIES,
} from './cost-basis/jurisdictions/jurisdiction-configs.js';
export { CostBasisArtifactService } from './cost-basis/artifacts/artifact-service.js';
export { persistCostBasisFailureSnapshot } from './cost-basis/artifacts/failure-snapshot-service.js';
export {
  buildAccountingExclusionFingerprint,
  type AccountingExclusionFingerprintInput,
} from './cost-basis/accounting-exclusion-fingerprint.js';
export { CostBasisWorkflow } from './cost-basis/workflow/cost-basis-workflow.js';
export type {
  CostBasisContext,
  CostBasisDependencyWatermark,
  CostBasisLedgerContext,
  CostBasisLedgerFacts,
  CostBasisLedgerJournal,
  CostBasisLedgerJournalDiagnostic,
  CostBasisLedgerPosting,
  CostBasisLedgerPostingSourceComponent,
  CostBasisLedgerRelationship,
  CostBasisLedgerRelationshipAllocation,
  CostBasisLedgerRelationshipOrigin,
  CostBasisLedgerSourceActivity,
  CostBasisProjectionWatermark,
  CostBasisSnapshotRecord,
  ICostBasisArtifactStore,
  ICostBasisContextReader,
  ICostBasisDependencyWatermarkReader,
  ICostBasisFailureSnapshotStore,
  ICostBasisLedgerContextReader,
} from './ports/index.js';
export type {
  CanadaCostBasisWorkflowResult,
  CostBasisExecutionMeta,
  CostBasisWorkflowExecutionOptions,
  CostBasisWorkflowResult,
  StandardCostBasisWorkflowResult,
  StandardLedgerCostBasisCalculation,
  StandardLedgerCostBasisExecutionMeta,
  StandardLedgerCostBasisProjectionAudit,
  StandardLedgerCostBasisWorkflowResult,
} from './cost-basis/workflow/cost-basis-workflow.js';
export type { ValidatedCostBasisConfig } from './cost-basis/workflow/cost-basis-input.js';
export {
  buildCostBasisInput,
  validateCostBasisInput,
  validateMethodJurisdictionCombination,
} from './cost-basis/workflow/cost-basis-input.js';
export {
  checkTransactionPriceCoverage,
  getCostBasisRebuildTransactions,
} from './cost-basis/workflow/price-completeness.js';
export {
  classifyLedgerCostBasisRelationshipTreatment,
  type LedgerCostBasisRelationshipBasisTreatment,
} from './cost-basis/ledger/ledger-cost-basis-relationship-treatment.js';
export {
  classifyLedgerCostBasisFeeAttachment,
  type LedgerCostBasisFeeAttachment,
  type LedgerCostBasisFeeAttachmentUnknownReason,
} from './cost-basis/ledger/ledger-cost-basis-fee-attachment.js';
export {
  buildLedgerCostBasisOperations,
  type BuildLedgerCostBasisOperationsInput,
  type LedgerCostBasisAcquireOperation,
  type LedgerCostBasisCarryLeg,
  type LedgerCostBasisCarryOperation,
  type LedgerCostBasisDisposeOperation,
  type LedgerCostBasisFeeOperation,
  type LedgerCostBasisOperation,
  type LedgerCostBasisOperationBlocker,
  type LedgerCostBasisOperationBlockerPropagation,
  type LedgerCostBasisOperationBlockerReason,
  type LedgerCostBasisOperationIdentityConfig,
  type LedgerCostBasisOperationProjection,
  type LedgerCostBasisOperationRelationshipContext,
} from './cost-basis/ledger/ledger-cost-basis-operation-projection.js';
export {
  projectLedgerCostBasisEvents,
  type LedgerCostBasisEventProjection,
  type LedgerCostBasisExcludedPosting,
  type LedgerCostBasisExclusionReason,
  type LedgerCostBasisInputEvent,
  type LedgerCostBasisInputEventKind,
  type LedgerCostBasisJournalContext,
  type LedgerCostBasisJournalPostingContext,
  type LedgerCostBasisPostingBlocker,
  type LedgerCostBasisProjectionBlocker,
  type LedgerCostBasisProjectionBlockerReason,
  type LedgerCostBasisRelationshipAllocationMismatchReason,
  type LedgerCostBasisRelationshipAllocationBlockerState,
  type LedgerCostBasisRelationshipBlocker,
  type LedgerCostBasisRelationshipBlockerAllocation,
  type LedgerCostBasisRelationshipBlockerReason,
  type LedgerCostBasisRelationshipAllocationValidationReason,
  type LedgerCostBasisPostingBlockerReason,
  type ProjectLedgerCostBasisEventsOptions,
} from './cost-basis/ledger/ledger-cost-basis-event-projection.js';
export {
  COST_BASIS_CALCULATION_ENGINE_VERSION,
  COST_BASIS_STORAGE_SCHEMA_VERSION,
  evaluateCostBasisArtifactFreshness,
  readCostBasisSnapshotArtifact,
} from './cost-basis/artifacts/artifact-snapshot-storage.js';
export { buildCostBasisConfigScopeKey, buildCostBasisScopeKey } from './cost-basis/cost-basis-scope-key.js';
export {
  StoredCanadaCostBasisArtifactSchema,
  StoredCostBasisArtifactEnvelopeSchema,
  StoredCostBasisDebugSchema,
  StoredStandardCostBasisArtifactSchema,
} from './cost-basis/artifacts/artifact-storage-schemas.js';
export { buildCostBasisFilingFacts } from './cost-basis/filing-facts/filing-facts-builder.js';
export { buildStandardLedgerCostBasisFilingFacts } from './cost-basis/filing-facts/standard-filing-facts-builder.js';
export type {
  CanadaCostBasisFilingFacts,
  StandardLedgerCostBasisAcquisitionFilingFact,
  StandardLedgerCostBasisDispositionFilingFact,
  StandardLedgerCostBasisFilingFacts,
  StandardLedgerCostBasisTransferFilingFact,
  StandardCostBasisDispositionFilingFact,
  StandardCostBasisFilingFacts,
} from './cost-basis/filing-facts/filing-facts-types.js';
export { buildTaxPackageBuildContext } from './cost-basis/export/tax-package-context-builder.js';
export { buildCanadaTaxPackage } from './cost-basis/export/canada-tax-package-builder.js';
export { buildUsTaxPackage } from './cost-basis/export/us-tax-package-builder.js';
export {
  formatIncompleteTransferLinkingIssueSummary,
  formatIncompleteTransferLinkingNotice,
  formatUnresolvedAssetReviewIssueDetails,
  formatUnresolvedAssetReviewIssueSummary,
  formatUnresolvedAssetReviewNotice,
} from './cost-basis/export/tax-package-readiness-messages.js';
export { deriveTaxPackageReadinessMetadata } from './cost-basis/export/tax-package-readiness-metadata.js';
export { buildCostBasisIssueNoticeSummaries } from './cost-basis/export/cost-basis-issue-notice-summaries.js';
export { evaluateTaxPackageReadiness } from './cost-basis/export/tax-package-review-gate.js';
export { exportTaxPackage } from './cost-basis/export/tax-package-exporter.js';
export type { ExportTaxPackageInput } from './cost-basis/export/tax-package-exporter.js';
export {
  TaxPackageScopeValidationError,
  validateTaxPackageScope,
} from './cost-basis/export/tax-package-scope-validator.js';
export type {
  TaxPackageExportResult,
  TaxPackageFile,
  TaxPackageConfigScope,
  TaxPackageIncompleteTransferLinkDetail,
  TaxPackageIssue,
  TaxPackageManifest,
  WrittenTaxPackageFile,
} from './cost-basis/export/tax-package-types.js';
export type {
  CostBasisIssueNoticeSummary,
  CostBasisIssueNoticeSummaryKind,
  CostBasisIssueNoticeSummarySeverity,
} from './cost-basis/export/cost-basis-issue-notice-summaries.js';
export type {
  ConvertedAcquisitionLot,
  ConvertedLotDisposal,
  ConvertedLotTransfer,
} from './cost-basis/model/report-types.js';
export {
  runStandardLedgerOperationPipeline,
  type RunStandardLedgerOperationPipelineInput,
  type StandardLedgerOperationPipelineResult,
} from './cost-basis/standard/operation-engine/standard-ledger-operation-pipeline.js';
export {
  runStandardLedgerCostBasisCalculation,
  type RunStandardLedgerCostBasisCalculationInput,
  type StandardLedgerCostBasisCalculationOptions,
} from './cost-basis/standard/workflow/run-standard-ledger-cost-basis-calculation.js';
export {
  runStandardLedgerOperationEngine,
  type RunStandardLedgerOperationEngineInput,
  type StandardLedgerBasisStatus,
  type StandardLedgerCalculationBlocker,
  type StandardLedgerCalculationBlockerReason,
  type StandardLedgerCarry,
  type StandardLedgerCarrySlice,
  type StandardLedgerDisposal,
  type StandardLedgerLot,
  type StandardLedgerLotProvenance,
  type StandardLedgerLotSelectionSlice,
  type StandardLedgerOperationEngineResult,
} from './cost-basis/standard/operation-engine/standard-ledger-operation-engine.js';
export {
  buildCanadaDisplayCostBasisReport,
  buildCanadaTaxReport,
} from './cost-basis/jurisdictions/canada/tax/canada-tax-report-builder.js';
export type {
  CanadaDisplayCostBasisReport,
  CanadaTaxInputContext,
  CanadaTaxReport,
} from './cost-basis/jurisdictions/canada/tax/canada-tax-types.js';
export { runCanadaCostBasisCalculation } from './cost-basis/jurisdictions/canada/workflow/run-canada-cost-basis-calculation.js';
