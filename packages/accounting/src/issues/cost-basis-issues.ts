import { formatTransactionFingerprintRef } from '@exitbook/core';

import { buildCostBasisScopeKey } from '../cost-basis/cost-basis-scope-key.js';
import type { TaxPackageValidatedScope } from '../cost-basis/export/tax-package-scope-validator.js';
import type {
  TaxPackageIncompleteTransferLinkDetail,
  TaxPackageIssue,
  TaxPackageMissingPriceDetail,
  TaxPackageReadinessMetadata,
  TaxPackageReadinessResult,
} from '../cost-basis/export/tax-package-types.js';
import type { ValidatedCostBasisConfig } from '../cost-basis/workflow/cost-basis-input.js';

import {
  type AccountingIssueDetailItem,
  type AccountingIssueEvidenceRef,
  type AccountingIssueNextAction,
  type AccountingIssueScopeSnapshot,
  type AccountingIssueScopeSummary,
  buildAccountingIssueRef,
} from './issue-model.js';

export interface BuildCostBasisAccountingIssueScopeSnapshotInput {
  config: ValidatedCostBasisConfig;
  profileId: number;
  readiness: TaxPackageReadinessResult;
  readinessMetadata: TaxPackageReadinessMetadata;
  scope: TaxPackageValidatedScope;
  updatedAt?: Date | undefined;
}

export interface BuildCostBasisExecutionFailureScopeSnapshotInput {
  config: ValidatedCostBasisConfig;
  error: Error;
  profileId: number;
  scope: TaxPackageValidatedScope;
  stage: string;
  updatedAt?: Date | undefined;
}

export function buildCostBasisAccountingIssueScopeSnapshot(
  input: BuildCostBasisAccountingIssueScopeSnapshotInput
): AccountingIssueScopeSnapshot {
  const updatedAt = input.updatedAt ?? new Date();
  const scopeKey = buildCostBasisScopeKey(input.profileId, input.config);
  const issues = input.readiness.issues.map((issue) =>
    buildTaxReadinessAccountingIssue(scopeKey, issue, input.readinessMetadata)
  );
  const blockingIssueCount = issues.filter((issue) => issue.issue.severity === 'blocked').length;
  const scope: AccountingIssueScopeSummary = {
    scopeKind: 'cost-basis',
    scopeKey,
    profileId: input.profileId,
    title: buildCostBasisScopeTitle(input.scope),
    status: issues.length === 0 ? 'ready' : 'has-open-issues',
    openIssueCount: issues.length,
    blockingIssueCount,
    updatedAt,
    metadata: {
      currency: input.config.currency,
      jurisdiction: input.scope.config.jurisdiction,
      method: input.scope.config.method,
      taxYear: input.scope.config.taxYear,
    },
  };

  return {
    scope,
    issues,
  };
}

export function buildCostBasisExecutionFailureScopeSnapshot(
  input: BuildCostBasisExecutionFailureScopeSnapshotInput
): AccountingIssueScopeSnapshot {
  const updatedAt = input.updatedAt ?? new Date();
  const scopeKey = buildCostBasisScopeKey(input.profileId, input.config);
  const issue = buildCostBasisExecutionFailureIssue(scopeKey, input.stage, input.error);

  return {
    scope: {
      scopeKind: 'cost-basis',
      scopeKey,
      profileId: input.profileId,
      title: buildCostBasisScopeTitle(input.scope),
      status: 'failed',
      openIssueCount: 1,
      blockingIssueCount: 1,
      updatedAt,
      metadata: {
        currency: input.config.currency,
        jurisdiction: input.scope.config.jurisdiction,
        method: input.scope.config.method,
        taxYear: input.scope.config.taxYear,
      },
    },
    issues: [issue],
  };
}

function buildCostBasisScopeTitle(scope: TaxPackageValidatedScope): string {
  return `${scope.config.jurisdiction} / ${scope.config.method} / ${scope.config.taxYear}`;
}

function buildTaxReadinessAccountingIssue(
  scopeKey: string,
  issue: TaxPackageIssue,
  readinessMetadata: TaxPackageReadinessMetadata
): AccountingIssueScopeSnapshot['issues'][number] {
  const issueKey = buildTaxReadinessIssueKey(issue);
  const txRef =
    issue.affectedArtifact === 'source transaction' ? formatIssueTransactionRef(issue.affectedRowRef) : undefined;
  const issueDetail = buildTaxReadinessDetails(issue, readinessMetadata);
  const nextActions = buildTaxReadinessNextActions(issue, txRef);
  const evidenceRefs = buildTaxReadinessEvidenceRefs(issue, txRef);
  const detailItem: AccountingIssueDetailItem = {
    issueRef: buildAccountingIssueRef(scopeKey, issueKey),
    scope: {
      kind: 'cost-basis',
      key: scopeKey,
    },
    family: issue.code === 'MISSING_PRICE_DATA' ? 'missing_price' : 'tax_readiness',
    code: issue.code,
    severity: issue.severity,
    summary: issue.summary,
    details: issueDetail,
    whyThisMatters: buildTaxReadinessWhyThisMatters(issue),
    evidenceRefs,
    nextActions,
  };

  return {
    issueKey,
    issue: detailItem,
  };
}

function buildCostBasisExecutionFailureIssue(
  scopeKey: string,
  stage: string,
  error: Error
): AccountingIssueScopeSnapshot['issues'][number] {
  const issueKey = `execution_failure:${stage}`;

  return {
    issueKey,
    issue: {
      issueRef: buildAccountingIssueRef(scopeKey, issueKey),
      scope: {
        kind: 'cost-basis',
        key: scopeKey,
      },
      family: 'execution_failure',
      code: 'WORKFLOW_EXECUTION_FAILED',
      severity: 'blocked',
      summary: `Cost basis execution failed during ${formatExecutionFailureStage(stage)}.`,
      details: `Stage: ${stage}\nError: ${error.message}`,
      whyThisMatters: 'Blocks this filing scope until the owning workflow can run successfully.',
      evidenceRefs: [],
      nextActions: [
        {
          kind: 'review_execution_failure',
          label: 'Review failure detail',
          mode: 'review_only',
        },
      ],
    },
  };
}

function buildTaxReadinessIssueKey(issue: TaxPackageIssue): string {
  return `tax_readiness:${issue.code}|${issue.affectedArtifact ?? 'scope'}|${issue.affectedRowRef ?? 'scope'}`;
}

function formatExecutionFailureStage(stage: string): string {
  switch (stage) {
    case 'cost-basis-workflow.execute':
      return 'cost basis calculation';
    case 'tax-package-context-builder':
      return 'tax package context build';
    default:
      return stage;
  }
}

function buildTaxReadinessDetails(issue: TaxPackageIssue, readinessMetadata: TaxPackageReadinessMetadata): string {
  if (issue.code === 'MISSING_PRICE_DATA') {
    const detail = findMissingPriceDetail(readinessMetadata, issue.affectedRowRef);
    if (detail) {
      return `${issue.details} ${buildMissingPriceExample(detail)}`;
    }

    return issue.details;
  }

  if (issue.code !== 'INCOMPLETE_TRANSFER_LINKING') {
    return issue.details;
  }

  const sample = readinessMetadata.incompleteTransferLinkDetails?.[0];
  if (!sample) {
    return issue.details;
  }

  return `${issue.details} ${buildIncompleteTransferLinkExample(sample)}`;
}

function buildIncompleteTransferLinkExample(detail: TaxPackageIncompleteTransferLinkDetail): string {
  const date = detail.transactionDatetime.slice(0, 10);
  return `Example: ${detail.assetSymbol} on ${date}.`;
}

function buildMissingPriceExample(detail: TaxPackageMissingPriceDetail): string {
  const date = detail.transactionDatetime.slice(0, 10);
  const missingItems = detail.missingItems
    .map((item) => `${item.kind} ${item.assetSymbol}`)
    .sort()
    .join(', ');
  return `Example: ${missingItems} on ${date}.`;
}

function buildTaxReadinessWhyThisMatters(issue: TaxPackageIssue): string {
  if (issue.code === 'MISSING_PRICE_DATA') {
    return 'Blocks this filing scope until the missing price coverage is resolved.';
  }

  if (issue.severity === 'blocked') {
    return 'Blocks this filing scope from being ready for reporting.';
  }

  return 'This filing scope can be generated, but the affected rows should be reviewed before filing.';
}

function buildTaxReadinessEvidenceRefs(
  issue: TaxPackageIssue,
  txRef: string | undefined
): AccountingIssueEvidenceRef[] {
  if (txRef === undefined) {
    return [];
  }

  return [
    {
      kind: 'transaction',
      ref: txRef,
    },
  ];
}

function buildTaxReadinessNextActions(issue: TaxPackageIssue, txRef: string | undefined): AccountingIssueNextAction[] {
  switch (issue.code) {
    case 'MISSING_PRICE_DATA':
      return txRef === undefined
        ? [
            {
              kind: 'review_prices',
              label: 'Review in prices',
              mode: 'routed',
              routeTarget: {
                family: 'prices',
              },
            },
          ]
        : [
            {
              kind: 'review_prices',
              label: 'Review in prices',
              mode: 'routed',
              routeTarget: {
                family: 'prices',
              },
            },
            {
              kind: 'inspect_transaction',
              label: 'Inspect transaction',
              mode: 'review_only',
              routeTarget: {
                family: 'transactions',
                selectorKind: 'tx-ref',
                selectorValue: txRef,
              },
            },
          ];
    case 'UNRESOLVED_ASSET_REVIEW':
      return [
        {
          kind: 'review_asset',
          label: 'Review in assets',
          mode: 'routed',
          routeTarget: {
            family: 'assets',
          },
        },
      ];
    case 'UNKNOWN_TRANSACTION_CLASSIFICATION':
    case 'UNCERTAIN_PROCEEDS_ALLOCATION':
      return txRef === undefined
        ? []
        : [
            {
              kind: 'inspect_transaction',
              label: 'Inspect transaction',
              mode: 'review_only',
              routeTarget: {
                family: 'transactions',
                selectorKind: 'tx-ref',
                selectorValue: txRef,
              },
            },
          ];
    case 'INCOMPLETE_TRANSFER_LINKING':
      return [
        {
          kind: 'review_links',
          label: 'Review in links',
          mode: 'routed',
          routeTarget: {
            family: 'links',
          },
        },
      ];
    case 'FX_FALLBACK_USED':
      return [
        {
          kind: 'review_filing_output',
          label: 'Review filing output',
          mode: 'review_only',
        },
      ];
  }
}

function findMissingPriceDetail(
  readinessMetadata: TaxPackageReadinessMetadata,
  affectedRowRef: string | undefined
): TaxPackageMissingPriceDetail | undefined {
  if (affectedRowRef === undefined) {
    return undefined;
  }

  return readinessMetadata.missingPriceDetails?.find((detail) => detail.reference === affectedRowRef);
}

function formatIssueTransactionRef(reference: string | undefined): string | undefined {
  if (!reference || reference.trim().length === 0) {
    return undefined;
  }

  return formatTransactionFingerprintRef(reference);
}
