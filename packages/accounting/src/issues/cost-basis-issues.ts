import { formatTransactionFingerprintRef } from '@exitbook/core';

import { buildCostBasisScopeKey } from '../cost-basis/artifacts/artifact-snapshot-storage.js';
import type { TaxPackageValidatedScope } from '../cost-basis/export/tax-package-scope-validator.js';
import type {
  TaxPackageIncompleteTransferLinkDetail,
  TaxPackageIssue,
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

export function buildCostBasisAccountingIssueScopeKey(profileId: number, config: ValidatedCostBasisConfig): string {
  return `profile:${profileId}:${buildCostBasisScopeKey(config)}`;
}

export function buildCostBasisAccountingIssueScopeSnapshot(
  input: BuildCostBasisAccountingIssueScopeSnapshotInput
): AccountingIssueScopeSnapshot {
  const updatedAt = input.updatedAt ?? new Date();
  const scopeKey = buildCostBasisAccountingIssueScopeKey(input.profileId, input.config);
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
    family: 'tax_readiness',
    code: issue.code,
    severity: issue.severity,
    status: 'open',
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

function buildTaxReadinessIssueKey(issue: TaxPackageIssue): string {
  return `tax_readiness:${issue.code}|${issue.affectedArtifact ?? 'scope'}|${issue.affectedRowRef ?? 'scope'}`;
}

function buildTaxReadinessDetails(issue: TaxPackageIssue, readinessMetadata: TaxPackageReadinessMetadata): string {
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

function buildTaxReadinessWhyThisMatters(issue: TaxPackageIssue): string {
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
      return [
        {
          kind: 'review_prices',
          label: 'Review in prices',
          mode: 'routed',
          routeTarget: {
            family: 'prices',
          },
        },
      ];
    case 'UNRESOLVED_ASSET_REVIEW':
      return [
        {
          kind: 'review_assets',
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

function formatIssueTransactionRef(reference: string | undefined): string | undefined {
  if (!reference || reference.trim().length === 0) {
    return undefined;
  }

  return formatTransactionFingerprintRef(reference);
}
