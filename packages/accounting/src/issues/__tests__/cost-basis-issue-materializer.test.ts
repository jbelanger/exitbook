import { err, ok } from '@exitbook/foundation';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockBuildTaxPackageBuildContext,
  mockCostBasisWorkflowExecute,
  mockDeriveTaxPackageReadinessMetadata,
  mockEvaluateTaxPackageReadiness,
  mockValidateTaxPackageScope,
} = vi.hoisted(() => ({
  mockBuildTaxPackageBuildContext: vi.fn(),
  mockCostBasisWorkflowExecute: vi.fn(),
  mockDeriveTaxPackageReadinessMetadata: vi.fn(),
  mockEvaluateTaxPackageReadiness: vi.fn(),
  mockValidateTaxPackageScope: vi.fn(),
}));

vi.mock('../../cost-basis/workflow/cost-basis-workflow.js', () => ({
  CostBasisWorkflow: class {
    execute = mockCostBasisWorkflowExecute;
  },
}));

vi.mock('../../cost-basis/export/tax-package-context-builder.js', () => ({
  buildTaxPackageBuildContext: mockBuildTaxPackageBuildContext,
}));

vi.mock('../../cost-basis/export/tax-package-readiness-metadata.js', () => ({
  deriveTaxPackageReadinessMetadata: mockDeriveTaxPackageReadinessMetadata,
}));

vi.mock('../../cost-basis/export/tax-package-review-gate.js', () => ({
  evaluateTaxPackageReadiness: mockEvaluateTaxPackageReadiness,
}));

vi.mock('../../cost-basis/export/tax-package-scope-validator.js', () => ({
  validateTaxPackageScope: mockValidateTaxPackageScope,
}));
import type { ValidatedCostBasisConfig } from '../../cost-basis/workflow/cost-basis-input.js';
import type { ICostBasisContextReader } from '../../ports/cost-basis-persistence.js';
import { materializeCostBasisAccountingIssueScopeSnapshot } from '../cost-basis-issue-materializer.js';

const CONFIG: ValidatedCostBasisConfig = {
  jurisdiction: 'CA',
  taxYear: 2024,
  method: 'average-cost' as const,
  currency: 'CAD' as const,
  startDate: new Date('2024-01-01T00:00:00.000Z'),
  endDate: new Date('2024-12-31T23:59:59.999Z'),
};

const VALIDATED_SCOPE = {
  config: {
    jurisdiction: 'CA' as const,
    taxYear: 2024,
    method: 'average-cost' as const,
    startDate: new Date('2024-01-01T00:00:00.000Z'),
    endDate: new Date('2024-12-31T23:59:59.999Z'),
  },
  filingScope: 'full_tax_year' as const,
  requiredStartDate: new Date('2024-01-01T00:00:00.000Z'),
  requiredEndDate: new Date('2024-12-31T23:59:59.999Z'),
};

beforeEach(() => {
  vi.clearAllMocks();

  mockValidateTaxPackageScope.mockReturnValue(ok(VALIDATED_SCOPE));
  mockCostBasisWorkflowExecute.mockResolvedValue(
    ok({
      kind: 'canada-workflow',
      executionMeta: {
        missingPricesCount: 1,
        retainedTransactionIds: [10],
      },
    } as never)
  );
  mockBuildTaxPackageBuildContext.mockReturnValue(
    ok({
      artifactRef: {
        calculationId: 'calc-1',
        scopeKey: 'profile:7:cost-basis:8b5e53cd',
      },
      workflowResult: {
        kind: 'canada-workflow',
      },
      sourceContext: {
        transactionsById: new Map(),
        accountsById: new Map(),
        confirmedLinksById: new Map(),
      },
    } as never)
  );
  mockDeriveTaxPackageReadinessMetadata.mockReturnValue({
    incompleteTransferLinkCount: 0,
  });
  mockEvaluateTaxPackageReadiness.mockReturnValue({
    status: 'blocked',
    issues: [
      {
        code: 'MISSING_PRICE_DATA',
        severity: 'blocked',
        summary: 'Required transaction price data is missing.',
        details: '1 retained transaction is missing price data.',
        recommendedAction: 'Review price coverage before filing.',
      },
    ],
    warnings: [],
    blockingIssues: [
      {
        code: 'MISSING_PRICE_DATA',
        severity: 'blocked',
        summary: 'Required transaction price data is missing.',
        details: '1 retained transaction is missing price data.',
        recommendedAction: 'Review price coverage before filing.',
      },
    ],
  });
});

describe('materializeCostBasisAccountingIssueScopeSnapshot', () => {
  it('runs the workflow in exclude mode and returns an accounting-owned scoped snapshot', async () => {
    const contextReader: ICostBasisContextReader = {
      loadCostBasisContext: async () =>
        ok({
          transactions: [],
          confirmedLinks: [],
          accounts: [],
        }),
    };

    const result = await materializeCostBasisAccountingIssueScopeSnapshot({
      config: CONFIG,
      contextReader,
      profileId: 7,
    });

    expect(result.isOk()).toBe(true);
    expect(mockCostBasisWorkflowExecute).toHaveBeenCalledWith(CONFIG, [], {
      accountingExclusionPolicy: undefined,
      assetReviewSummaries: undefined,
      missingPricePolicy: 'exclude',
    });
    if (result.isOk()) {
      expect(result.value.scope).toMatchObject({
        scopeKind: 'cost-basis',
        scopeKey: 'profile:7:cost-basis:8b5e53cd',
        title: 'CA / average-cost / 2024',
        openIssueCount: 1,
        blockingIssueCount: 1,
      });
      expect(result.value.issues[0]?.issue).toMatchObject({
        family: 'tax_readiness',
        code: 'MISSING_PRICE_DATA',
        summary: 'Required transaction price data is missing.',
      });
    }
  });

  it('returns an execution-failure issue snapshot when the workflow fails', async () => {
    mockCostBasisWorkflowExecute.mockResolvedValue(err(new Error('calculation exploded')));

    const contextReader: ICostBasisContextReader = {
      loadCostBasisContext: async () =>
        ok({
          transactions: [],
          confirmedLinks: [],
          accounts: [],
        }),
    };

    const result = await materializeCostBasisAccountingIssueScopeSnapshot({
      config: CONFIG,
      contextReader,
      profileId: 7,
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.scope).toMatchObject({
        scopeKind: 'cost-basis',
        scopeKey: 'profile:7:cost-basis:8b5e53cd',
        status: 'failed',
        openIssueCount: 1,
        blockingIssueCount: 1,
      });
      expect(result.value.issues[0]?.issue).toMatchObject({
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
      expect(result.value.issues[0]?.issue.details).toContain('Error: calculation exploded');
    }
  });
});
