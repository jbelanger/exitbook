import type { CostBasisJurisdiction, CostBasisMethod } from '../jurisdictions/jurisdiction-configs.js';
import type { ValidatedCostBasisConfig } from '../workflow/cost-basis-input.js';
import type { CostBasisWorkflowResult } from '../workflow/workflow-result-types.js';

export const TAX_PACKAGE_KIND = 'tax-package';
export const TAX_PACKAGE_VERSION = 1;

export type TaxPackageKind = typeof TAX_PACKAGE_KIND;
export type TaxPackageVersion = typeof TAX_PACKAGE_VERSION;

export type TaxPackageStatus = 'ready' | 'blocked';
export type TaxPackageIssueSeverity = 'warning' | 'blocked';
export type TaxPackageIssueCode =
  | 'MISSING_PRICE_DATA'
  | 'FX_FALLBACK_USED'
  | 'UNRESOLVED_ASSET_REVIEW'
  | 'UNKNOWN_TRANSACTION_CLASSIFICATION'
  | 'UNCERTAIN_PROCEEDS_ALLOCATION'
  | 'INCOMPLETE_TRANSFER_LINKING';

export interface TaxPackageIssue {
  code: TaxPackageIssueCode;
  severity: TaxPackageIssueSeverity;
  summary: string;
  details: string;
  affectedArtifact?: string | undefined;
  affectedRowRef?: string | undefined;
  recommendedAction?: string | undefined;
}

export interface TaxPackageArtifactIndexEntry {
  logicalName: string;
  relativePath: string;
  mediaType: string;
  purpose: string;
  rowCount?: number | undefined;
  sha256?: string | undefined;
}

export interface TaxPackageSummaryTotals {
  totalProceeds: string;
  totalCostBasis: string;
  totalGainLoss: string;
  totalTaxableGainLoss: string;
}

interface TaxPackageTransactionIssueDetailBase {
  diagnosticCode: string;
  diagnosticMessage: string;
  operationCategory?: string | undefined;
  operationType?: string | undefined;
  reference: string;
  platformKey: string;
  transactionDatetime: string;
  transactionId: number;
}

export type TaxPackageUnknownTransactionClassificationDetail = TaxPackageTransactionIssueDetailBase;

export type TaxPackageUncertainProceedsAllocationDetail = TaxPackageTransactionIssueDetailBase;

export interface TaxPackageIncompleteTransferLinkDetail {
  assetSymbol: string;
  rowId: string;
  sourcePlatformKey?: string | undefined;
  sourceTransactionId?: number | undefined;
  targetPlatformKey?: string | undefined;
  targetTransactionId?: number | undefined;
  transactionDatetime: string;
  transactionId: number;
}

export interface TaxPackageMissingPriceItemDetail {
  assetSymbol: string;
  kind: 'inflow' | 'outflow' | 'fee';
}

export interface TaxPackageMissingPriceDetail {
  missingItems: readonly TaxPackageMissingPriceItemDetail[];
  platformKey: string;
  reference: string;
  transactionDatetime: string;
  transactionId: number;
}

export interface TaxPackageManifest {
  packageKind: TaxPackageKind;
  packageVersion: TaxPackageVersion;
  packageStatus: TaxPackageStatus;
  jurisdiction: CostBasisJurisdiction;
  taxYear: number;
  calculationId: string;
  snapshotId?: string | undefined;
  scopeKey: string;
  generatedAt: string;
  method: CostBasisMethod;
  taxCurrency: string;
  summaryTotals: TaxPackageSummaryTotals;
  warnings: readonly TaxPackageIssue[];
  blockingIssues: readonly TaxPackageIssue[];
  artifactIndex: readonly TaxPackageArtifactIndexEntry[];
}

export interface TaxPackageFile {
  logicalName: string;
  relativePath: string;
  mediaType: string;
  purpose: string;
  content: string;
}

export interface WrittenTaxPackageFile extends TaxPackageFile {
  absolutePath: string;
  sha256: string;
  bytesWritten: number;
}

export interface ExportTaxPackageArtifactRef {
  calculationId: string;
  snapshotId?: string | undefined;
  scopeKey: string;
}

export interface TaxPackageExportResult {
  artifactRef: ExportTaxPackageArtifactRef;
  files: readonly WrittenTaxPackageFile[];
  manifest: TaxPackageManifest;
  status: TaxPackageStatus;
}

export interface TaxPackageBuildResult {
  files: readonly TaxPackageFile[];
  manifest: TaxPackageManifest;
  status: TaxPackageStatus;
}

export type TaxPackageConfigScope = Pick<
  ValidatedCostBasisConfig,
  'endDate' | 'jurisdiction' | 'method' | 'startDate' | 'taxYear'
>;

export interface TaxPackageReadinessMetadata {
  allocationUncertainCount?: number | undefined;
  allocationUncertainDetails?: readonly TaxPackageUncertainProceedsAllocationDetail[] | undefined;
  fxFallbackCount?: number | undefined;
  incompleteTransferLinkCount?: number | undefined;
  incompleteTransferLinkDetails?: readonly TaxPackageIncompleteTransferLinkDetail[] | undefined;
  missingPriceDetails?: readonly TaxPackageMissingPriceDetail[] | undefined;
  unknownTransactionClassificationCount?: number | undefined;
  unknownTransactionClassificationDetails?: readonly TaxPackageUnknownTransactionClassificationDetail[] | undefined;
  unresolvedAssetReviewCount?: number | undefined;
}

export interface TaxPackageReviewGateInput<TScope> {
  workflowResult: CostBasisWorkflowResult;
  scope: TScope;
  metadata?: TaxPackageReadinessMetadata | undefined;
}

export interface TaxPackageReadinessResult {
  status: TaxPackageStatus;
  issues: readonly TaxPackageIssue[];
  warnings: readonly TaxPackageIssue[];
  blockingIssues: readonly TaxPackageIssue[];
}
