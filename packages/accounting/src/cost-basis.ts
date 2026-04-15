export type { FiatCurrency } from './cost-basis/model/cost-basis-config.js';
export { getDefaultDateRange } from './cost-basis/model/cost-basis-config.js';
export { buildAccountingEntryReader } from './accounting-layer/accounting-entry-reader.js';
export {
  buildAccountingEntryFingerprintMaterial,
  computeAccountingEntryFingerprint,
} from './accounting-layer/accounting-entry-fingerprint.js';
export { buildAccountingEntriesFromTransactions } from './accounting-layer/build-accounting-entries-from-transactions.js';
export type {
  AccountingEntry,
  AccountingEntryDraft,
  AccountingEntryKind,
  AccountingProvenanceBinding,
  AssetAccountingEntry,
  FeeAccountingEntry,
} from './accounting-layer/accounting-entry-types.js';
export type { AccountingEntrySource, IAccountingEntryReader, IAccountingEntrySourceReader } from './ports/index.js';
export type { CostBasisJurisdiction, CostBasisMethod } from './cost-basis/jurisdictions/jurisdiction-configs.js';
export {
  getDefaultCostBasisCurrencyForJurisdiction,
  getDefaultCostBasisMethodForJurisdiction,
  listCostBasisJurisdictionCapabilities,
  listCostBasisMethodCapabilitiesForJurisdiction,
  SUPPORTED_COST_BASIS_FIAT_CURRENCIES,
} from './cost-basis/jurisdictions/jurisdiction-configs.js';
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
export { CostBasisArtifactService } from './cost-basis/artifacts/artifact-service.js';
export { persistCostBasisFailureSnapshot } from './cost-basis/artifacts/failure-snapshot-service.js';
export { CostBasisWorkflow } from './cost-basis/workflow/cost-basis-workflow.js';
export type {
  CostBasisContext,
  CostBasisDependencyWatermark,
  CostBasisProjectionWatermark,
  CostBasisSnapshotRecord,
  ICostBasisArtifactStore,
  ICostBasisContextReader,
  ICostBasisDependencyWatermarkReader,
  ICostBasisFailureSnapshotStore,
} from './ports/index.js';
export type {
  CanadaCostBasisWorkflowResult,
  CostBasisExecutionMeta,
  CostBasisWorkflowExecutionOptions,
  CostBasisWorkflowResult,
  StandardCostBasisWorkflowResult,
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
export { buildCostBasisScopedTransactions } from './cost-basis/standard/matching/build-cost-basis-scoped-transactions.js';
export {
  filterConfirmableTransferProposals,
  validateTransferProposalConfirmability,
} from './cost-basis/standard/matching/transfer-proposal-confirmability.js';
export { validateScopedTransferLinks } from './cost-basis/standard/matching/validated-scoped-transfer-links.js';
export {
  buildAccountingExclusionFingerprint,
  buildCostBasisScopeKey,
  COST_BASIS_CALCULATION_ENGINE_VERSION,
  COST_BASIS_STORAGE_SCHEMA_VERSION,
  evaluateCostBasisArtifactFreshness,
  readCostBasisSnapshotArtifact,
} from './cost-basis/artifacts/artifact-snapshot-storage.js';
export {
  StoredCanadaCostBasisArtifactSchema,
  StoredCostBasisArtifactEnvelopeSchema,
  StoredCostBasisDebugSchema,
  StoredStandardCostBasisArtifactSchema,
} from './cost-basis/artifacts/artifact-storage-schemas.js';
export { buildCostBasisFilingFacts } from './cost-basis/filing-facts/filing-facts-builder.js';
export type {
  CanadaCostBasisFilingFacts,
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
  TaxPackageIncompleteTransferLinkDetail,
  TaxPackageIssue,
  TaxPackageManifest,
  WrittenTaxPackageFile,
} from './cost-basis/export/tax-package-types.js';
export type {
  ConvertedAcquisitionLot,
  ConvertedLotDisposal,
  ConvertedLotTransfer,
} from './cost-basis/model/report-types.js';
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
