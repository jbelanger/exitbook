import { describe, expect, it } from 'vitest';

import { buildCostBasisScopeKey } from '../../cost-basis/cost-basis-scope-key.js';
import type { TaxPackageValidatedScope } from '../../cost-basis/export/tax-package-scope-validator.js';
import type {
  TaxPackageReadinessMetadata,
  TaxPackageReadinessResult,
} from '../../cost-basis/export/tax-package-types.js';
import type { ValidatedCostBasisConfig } from '../../cost-basis/workflow/cost-basis-input.js';
import {
  buildCostBasisAccountingIssueScopeSnapshot,
  buildCostBasisExecutionFailureScopeSnapshot,
} from '../cost-basis-issues.js';

const CONFIG: ValidatedCostBasisConfig = {
  jurisdiction: 'CA',
  taxYear: 2024,
  method: 'average-cost',
  currency: 'CAD',
  startDate: new Date('2024-01-01T00:00:00.000Z'),
  endDate: new Date('2024-12-31T23:59:59.999Z'),
};

const VALIDATED_SCOPE: TaxPackageValidatedScope = {
  config: {
    jurisdiction: 'CA',
    taxYear: 2024,
    method: 'average-cost',
    startDate: new Date('2024-01-01T00:00:00.000Z'),
    endDate: new Date('2024-12-31T23:59:59.999Z'),
  },
  filingScope: 'full_tax_year',
  requiredStartDate: new Date('2024-01-01T00:00:00.000Z'),
  requiredEndDate: new Date('2024-12-31T23:59:59.999Z'),
};

describe('cost-basis-issues', () => {
  it('builds a profile-qualified deterministic cost-basis issue scope key', () => {
    const left = buildCostBasisScopeKey(7, CONFIG);
    const right = buildCostBasisScopeKey(7, { ...CONFIG });
    const differentProfile = buildCostBasisScopeKey(8, CONFIG);

    expect(left).toBe(right);
    expect(left).toMatch(/^profile:7:cost-basis:/);
    expect(differentProfile).not.toBe(left);
  });

  it('builds scoped tax-readiness issues with typed next actions and transaction evidence', () => {
    const readiness: TaxPackageReadinessResult = {
      status: 'blocked',
      blockingIssues: [
        {
          code: 'UNKNOWN_TRANSACTION_CLASSIFICATION',
          severity: 'blocked',
          summary: 'A tax-relevant transaction still has unresolved operation classification.',
          details: 'Transaction still needs classification review.',
          affectedArtifact: 'source transaction',
          affectedRowRef: 'abcdef1234567890',
          recommendedAction: 'Review the transaction operation classification before filing.',
        },
      ],
      warnings: [
        {
          code: 'INCOMPLETE_TRANSFER_LINKING',
          severity: 'warning',
          summary: 'Some transfers were not fully linked.',
          details: '1 transfer requires manual review because a confirmed source/target link is missing.',
          recommendedAction: 'Create or confirm the missing transfer links before filing.',
        },
      ],
      issues: [
        {
          code: 'UNKNOWN_TRANSACTION_CLASSIFICATION',
          severity: 'blocked',
          summary: 'A tax-relevant transaction still has unresolved operation classification.',
          details: 'Transaction still needs classification review.',
          affectedArtifact: 'source transaction',
          affectedRowRef: 'abcdef1234567890',
          recommendedAction: 'Review the transaction operation classification before filing.',
        },
        {
          code: 'INCOMPLETE_TRANSFER_LINKING',
          severity: 'warning',
          summary: 'Some transfers were not fully linked.',
          details: '1 transfer requires manual review because a confirmed source/target link is missing.',
          recommendedAction: 'Create or confirm the missing transfer links before filing.',
        },
      ],
    };
    const readinessMetadata: TaxPackageReadinessMetadata = {
      incompleteTransferLinkCount: 1,
      incompleteTransferLinkDetails: [
        {
          assetSymbol: 'ADA',
          rowId: 'transfer-1',
          transactionDatetime: '2024-07-25T20:35:00.000Z',
          transactionId: 88,
        },
      ],
    };

    const snapshot = buildCostBasisAccountingIssueScopeSnapshot({
      config: CONFIG,
      profileId: 3,
      readiness,
      readinessMetadata,
      scope: VALIDATED_SCOPE,
      updatedAt: new Date('2026-04-14T16:30:00.000Z'),
    });

    expect(snapshot.scope).toMatchObject({
      scopeKind: 'cost-basis',
      profileId: 3,
      title: 'CA / average-cost / 2024',
      status: 'has-open-issues',
      openIssueCount: 2,
      blockingIssueCount: 1,
      metadata: {
        jurisdiction: 'CA',
        method: 'average-cost',
        taxYear: 2024,
        currency: 'CAD',
      },
    });

    expect(snapshot.issues.map((issue) => issue.issue.family)).toEqual(['tax_readiness', 'tax_readiness']);
    expect(snapshot.issues[0]?.issue.evidenceRefs).toEqual([
      {
        kind: 'transaction',
        ref: 'abcdef1234',
      },
    ]);
    expect(snapshot.issues[0]?.issue.nextActions[0]).toMatchObject({
      kind: 'inspect_transaction',
      mode: 'review_only',
      routeTarget: {
        family: 'transactions',
        selectorKind: 'tx-ref',
        selectorValue: 'abcdef1234',
      },
    });
    expect(snapshot.issues[1]?.issue.nextActions[0]).toMatchObject({
      kind: 'review_links',
      mode: 'routed',
      routeTarget: {
        family: 'links',
      },
    });
    expect(snapshot.issues[1]?.issue.details).toContain('Example: ADA on 2024-07-25.');
  });

  it('marks a scoped lens ready when no tax-readiness issues remain', () => {
    const snapshot = buildCostBasisAccountingIssueScopeSnapshot({
      config: CONFIG,
      profileId: 3,
      readiness: {
        status: 'ready',
        issues: [],
        warnings: [],
        blockingIssues: [],
      },
      readinessMetadata: {},
      scope: VALIDATED_SCOPE,
      updatedAt: new Date('2026-04-14T16:30:00.000Z'),
    });

    expect(snapshot.scope.status).toBe('ready');
    expect(snapshot.scope.openIssueCount).toBe(0);
    expect(snapshot.issues).toHaveLength(0);
  });

  it('builds an execution-failure scoped snapshot with failed status', () => {
    const snapshot = buildCostBasisExecutionFailureScopeSnapshot({
      config: CONFIG,
      error: new Error('runtime exploded'),
      profileId: 3,
      scope: VALIDATED_SCOPE,
      stage: 'cost-basis-workflow.execute',
      updatedAt: new Date('2026-04-16T12:00:00.000Z'),
    });

    expect(snapshot.scope).toMatchObject({
      scopeKind: 'cost-basis',
      profileId: 3,
      scopeKey: 'profile:3:cost-basis:8b5e53cd',
      status: 'failed',
      openIssueCount: 1,
      blockingIssueCount: 1,
    });
    expect(snapshot.issues[0]?.issue).toMatchObject({
      family: 'execution_failure',
      code: 'WORKFLOW_EXECUTION_FAILED',
      summary: 'Cost basis execution failed during cost basis calculation.',
      nextActions: [
        {
          kind: 'review_execution_failure',
          label: 'Review failure detail',
          mode: 'review_only',
        },
      ],
    });
    expect(snapshot.issues[0]?.issue.details).toContain('runtime exploded');
  });
});
