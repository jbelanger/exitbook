/**
 * @exitbook/accounting
 *
 * Cost basis calculation, acquisition lot tracking, and capital gains/losses reporting.
 * Supports multiple jurisdictions (Canada, US, UK, EU) with pluggable tax rules.
 */

// Configuration
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

// Domain types
export type {
  AcquisitionLot,
  CostBasisMethodSupport,
  LotDisposal,
  LotTransfer,
  TaxAssetIdentityPolicy,
} from './cost-basis/model/types.js';
export type {
  AccountingExclusionApplyResult,
  AccountingExclusionPolicy,
} from './cost-basis/standard/validation/accounting-exclusion-policy.js';
export {
  applyAccountingExclusionPolicy,
  createAccountingExclusionPolicy,
  hasAccountingExclusions,
  isExcludedAsset,
} from './cost-basis/standard/validation/accounting-exclusion-policy.js';

// Cost basis calculation
export { runCostBasisPipeline } from './cost-basis/standard/calculation/run-standard-cost-basis.js';
export { CostBasisArtifactService } from './cost-basis/artifacts/artifact-service.js';
export { persistCostBasisFailureSnapshot } from './cost-basis/artifacts/failure-snapshot-service.js';
export { CostBasisWorkflow } from './cost-basis/workflow/cost-basis-workflow.js';
export {
  buildAccountingExclusionFingerprint,
  buildCostBasisScopeKey,
  COST_BASIS_CALCULATION_ENGINE_VERSION,
  COST_BASIS_STORAGE_SCHEMA_VERSION,
  evaluateCostBasisArtifactFreshness,
  readCostBasisSnapshotArtifact,
  StoredCanadaCostBasisArtifactSchema,
  StoredCostBasisArtifactEnvelopeSchema,
  StoredCostBasisDebugSchema,
  StoredStandardCostBasisArtifactSchema,
} from './cost-basis/artifacts/artifact-storage.js';
export { buildCostBasisScopedTransactions } from './cost-basis/standard/matching/build-cost-basis-scoped-transactions.js';
export {
  filterConfirmableTransferProposals,
  validateTransferProposalConfirmability,
} from './cost-basis/standard/matching/transfer-proposal-confirmability.js';
export { validateScopedTransferLinks } from './cost-basis/standard/matching/validated-scoped-transfer-links.js';
export type {
  CanadaCostBasisWorkflowResult,
  CostBasisExecutionMeta,
  CostBasisWorkflowExecutionOptions,
  CostBasisWorkflowResult,
  StandardCostBasisWorkflowResult,
} from './cost-basis/workflow/cost-basis-workflow.js';
export { buildCostBasisFilingFacts } from './cost-basis/filing-facts/filing-facts-builder.js';
export type {
  CanadaCostBasisAcquisitionFilingFact,
  CanadaCostBasisDispositionFilingFact,
  CanadaCostBasisFilingFacts,
  CanadaCostBasisTransferFilingFact,
  CanadaSuperficialLossAdjustmentFilingFact,
  CostBasisFilingAcquisitionFact,
  CostBasisFilingAssetSummary,
  CostBasisFilingDispositionFact,
  CostBasisFilingFactAssetIdentity,
  CostBasisFilingFacts,
  CostBasisFilingFactsSummary,
  CostBasisFilingTaxTreatmentSummary,
  CostBasisFilingTransferFact,
  StandardCostBasisAcquisitionFilingFact,
  StandardCostBasisDispositionFilingFact,
  StandardCostBasisFilingFacts,
  StandardCostBasisTransferFilingFact,
} from './cost-basis/filing-facts/filing-facts-types.js';
export { buildTaxPackageBuildContext } from './cost-basis/export/tax-package-context-builder.js';
export { buildCanadaTaxPackage } from './cost-basis/export/canada-tax-package-builder.js';
export { buildUsTaxPackage } from './cost-basis/export/us-tax-package-builder.js';
export { deriveTaxPackageReadinessMetadata } from './cost-basis/export/tax-package-readiness-metadata.js';
export { evaluateTaxPackageReadiness } from './cost-basis/export/tax-package-review-gate.js';
export { exportTaxPackage } from './cost-basis/export/tax-package-exporter.js';
export type { ExportTaxPackageInput } from './cost-basis/export/tax-package-exporter.js';
export {
  TaxPackageScopeValidationError,
  validateTaxPackageScope,
} from './cost-basis/export/tax-package-scope-validator.js';
export type {
  TaxPackageArtifactRef,
  TaxPackageBuildContext,
  TaxPackageSourceContext,
} from './cost-basis/export/tax-package-build-context.js';
export type {
  ExportTaxPackageArtifactRef,
  ITaxPackageFileWriter,
  TaxPackageArtifactIndexEntry,
  TaxPackageConfigScope,
  TaxPackageBuildResult,
  TaxPackageExportResult,
  TaxPackageFile,
  TaxPackageIssue,
  TaxPackageIssueCode,
  TaxPackageIssueSeverity,
  TaxPackageKind,
  TaxPackageManifest,
  TaxPackageReadinessMetadata,
  TaxPackageReadinessResult,
  TaxPackageReviewGateInput,
  TaxPackageStatus,
  TaxPackageSummaryTotals,
  TaxPackageUncertainProceedsAllocationDetail,
  TaxPackageUnknownTransactionClassificationDetail,
  TaxPackageVersion,
  WrittenTaxPackageFile,
} from './cost-basis/export/tax-package-types.js';
export { TAX_PACKAGE_KIND, TAX_PACKAGE_VERSION } from './cost-basis/export/tax-package-types.js';
export type {
  TaxPackageScopeRequest,
  TaxPackageScopeValidationErrorCode,
  TaxPackageValidatedScope,
} from './cost-basis/export/tax-package-scope-validator.js';

// Reports
export type {
  ConvertedAcquisitionLot,
  ConvertedLotDisposal,
  ConvertedLotTransfer,
} from './cost-basis/model/report-types.js';

// Ports
export type {
  CostBasisArtifactKind,
  CostBasisContext,
  CostBasisDependencyWatermark,
  CostBasisProjectionWatermark,
  CostBasisSnapshotRecord,
  ICostBasisArtifactStore,
  ICostBasisContextReader,
  ICostBasisDependencyWatermarkReader,
} from './ports/index.js';

// Linking orchestrator
export { LinkingOrchestrator } from './linking/orchestration/linking-orchestrator.js';
export type { LinkingRunParams, LinkingRunResult } from './linking/orchestration/linking-orchestrator.js';
export type { LinkingEvent } from './linking/orchestration/linking-events.js';

// Transaction linking
export type { LinkStatus, MatchCriteria } from './linking/shared/types.js';
export {
  deriveTransferProposalStatus,
  getExplicitTransferProposalKey,
  getTransferProposalGroupKey,
  groupLinksByTransferProposal,
} from './linking/shared/transfer-proposals.js';

// Cost basis utilities
export type { CostBasisInput, ValidatedCostBasisConfig } from './cost-basis/workflow/cost-basis-input.js';
export { buildCostBasisInput, validateCostBasisInput } from './cost-basis/workflow/cost-basis-input.js';
export {
  checkTransactionPriceCoverage,
  getCostBasisRebuildTransactions,
} from './cost-basis/workflow/price-completeness.js';

export type { PriceEvent } from './price-enrichment/shared/price-events.js';
export {
  validateAssetFilter,
  extractAssetsNeedingPrices,
  extractPriceFetchCandidates,
  createPriceQuery,
  initializeStats,
  determineEnrichmentStages,
} from './price-enrichment/enrichment/price-fetch-utils.js';
export type { PriceFetchCandidate } from './price-enrichment/enrichment/price-fetch-utils.js';
export { PriceEnrichmentPipeline } from './price-enrichment/orchestration/price-enrichment-pipeline.js';
export type {
  PricesEnrichOptions,
  PricesEnrichResult,
} from './price-enrichment/orchestration/price-enrichment-pipeline.js';
export { StandardFxRateProvider } from './price-enrichment/fx/standard-fx-rate-provider.js';
export { buildCanadaTaxInputContext } from './cost-basis/jurisdictions/canada/tax/canada-tax-context-builder.js';
export { runCanadaAcbWorkflow } from './cost-basis/jurisdictions/canada/workflow/canada-acb-workflow.js';
export type {
  CanadaAcbWorkflowOptions,
  CanadaAcbWorkflowResult,
} from './cost-basis/jurisdictions/canada/workflow/canada-acb-workflow.js';
export { runCanadaCostBasisCalculation } from './cost-basis/jurisdictions/canada/workflow/run-canada-cost-basis-calculation.js';
export type { RunCanadaCostBasisCalculationParams } from './cost-basis/jurisdictions/canada/workflow/run-canada-cost-basis-calculation.js';
export type {
  CanadaTaxInputEvent,
  CanadaTaxInputEventKind,
  CanadaTaxInputContext,
  CanadaTaxValuation,
} from './cost-basis/jurisdictions/canada/tax/canada-tax-types.js';
export { runCanadaAcbEngine } from './cost-basis/jurisdictions/canada/workflow/canada-acb-engine.js';
export { runCanadaSuperficialLossEngine } from './cost-basis/jurisdictions/canada/workflow/canada-superficial-loss-engine.js';
export {
  buildCanadaDisplayCostBasisReport,
  buildCanadaTaxReport,
} from './cost-basis/jurisdictions/canada/tax/canada-tax-report-builder.js';
export type {
  CanadaAcbEngineResult,
  CanadaAcbPoolState,
  CanadaAcquisitionLayer,
  CanadaCostBasisCalculation,
  CanadaDisplayCostBasisReport,
  CanadaDisplayFxConversion,
  CanadaDisplayReportAcquisition,
  CanadaDisplayReportDisposition,
  CanadaDisplayReportSummary,
  CanadaDisplayReportTransfer,
  CanadaDispositionRecord,
  CanadaSuperficialLossAdjustmentEvent,
  CanadaSuperficialLossAdjustment,
  CanadaTaxReport,
  CanadaTaxReportAcquisition,
  CanadaTaxReportDisposition,
  CanadaTaxReportSummary,
  CanadaTaxReportTransfer,
} from './cost-basis/jurisdictions/canada/tax/canada-tax-types.js';
export type {
  CanadaSuperficialLossDispositionAdjustment,
  CanadaSuperficialLossEngineResult,
} from './cost-basis/jurisdictions/canada/workflow/canada-superficial-loss-types.js';
