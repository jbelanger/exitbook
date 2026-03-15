import { describe, expect, it } from 'vitest';

import { evaluateTaxPackageReadiness } from '../tax-package-review-gate.js';
import { validateTaxPackageScope } from '../tax-package-scope-validator.js';

import { createCanadaWorkflowArtifact, createStandardWorkflowArtifact } from './test-utils.js';

describe('evaluateTaxPackageReadiness', () => {
  it('returns ready when there are no blocking or review issues', () => {
    const scope = validateTaxPackageScope({
      config: {
        jurisdiction: 'US',
        method: 'fifo',
        taxYear: 2024,
        startDate: new Date('2024-01-01T00:00:00.000Z'),
        endDate: new Date('2024-12-31T23:59:59.999Z'),
      },
    });

    if (scope.isErr()) {
      throw scope.error;
    }

    const result = evaluateTaxPackageReadiness({
      workflowResult: createStandardWorkflowArtifact(),
      scope: scope.value,
    });

    expect(result.status).toBe('ready');
    expect(result.issues).toEqual([]);
    expect(result.blockingIssues).toEqual([]);
    expect(result.reviewItems).toEqual([]);
  });

  it('blocks export when retained transactions still lack price data', () => {
    const scope = validateTaxPackageScope({
      config: {
        jurisdiction: 'US',
        method: 'fifo',
        taxYear: 2024,
        startDate: new Date('2024-01-01T00:00:00.000Z'),
        endDate: new Date('2024-12-31T23:59:59.999Z'),
      },
    });

    if (scope.isErr()) {
      throw scope.error;
    }

    const result = evaluateTaxPackageReadiness({
      workflowResult: createStandardWorkflowArtifact({
        executionMeta: {
          missingPricesCount: 2,
          retainedTransactionIds: [1, 2, 3],
        },
      }),
      scope: scope.value,
    });

    expect(result.status).toBe('blocked');
    expect(result.blockingIssues).toHaveLength(1);
    expect(result.blockingIssues[0]?.code).toBe('MISSING_PRICE_DATA');
  });

  it('marks export review_required when only review issues remain', () => {
    const scope = validateTaxPackageScope({
      config: {
        jurisdiction: 'CA',
        method: 'average-cost',
        taxYear: 2024,
        startDate: new Date('2024-01-01T00:00:00.000Z'),
        endDate: new Date('2024-12-31T23:59:59.999Z'),
      },
    });

    if (scope.isErr()) {
      throw scope.error;
    }

    const result = evaluateTaxPackageReadiness({
      workflowResult: createCanadaWorkflowArtifact(),
      scope: scope.value,
      metadata: {
        fxFallbackCount: 1,
        incompleteTransferLinkCount: 2,
      },
    });

    expect(result.status).toBe('review_required');
    expect(result.blockingIssues).toEqual([]);
    expect(result.reviewItems.map((issue) => issue.code)).toEqual(['FX_FALLBACK_USED', 'INCOMPLETE_TRANSFER_LINKING']);
  });

  it('keeps blocked status when review and blocking issues are both present', () => {
    const scope = validateTaxPackageScope({
      config: {
        jurisdiction: 'CA',
        method: 'average-cost',
        taxYear: 2024,
        startDate: new Date('2024-01-01T00:00:00.000Z'),
        endDate: new Date('2024-12-31T23:59:59.999Z'),
      },
    });

    if (scope.isErr()) {
      throw scope.error;
    }

    const result = evaluateTaxPackageReadiness({
      workflowResult: createCanadaWorkflowArtifact(),
      scope: scope.value,
      metadata: {
        unresolvedAssetReviewCount: 1,
        fxFallbackCount: 1,
      },
    });

    expect(result.status).toBe('blocked');
    expect(result.blockingIssues.map((issue) => issue.code)).toEqual(['UNRESOLVED_ASSET_REVIEW']);
    expect(result.reviewItems.map((issue) => issue.code)).toEqual(['FX_FALLBACK_USED']);
  });

  it('treats unknown transaction classification as blocking', () => {
    const scope = validateTaxPackageScope({
      config: {
        jurisdiction: 'US',
        method: 'lifo',
        taxYear: 2024,
        startDate: new Date('2024-01-01T00:00:00.000Z'),
        endDate: new Date('2024-12-31T23:59:59.999Z'),
      },
    });

    if (scope.isErr()) {
      throw scope.error;
    }

    const result = evaluateTaxPackageReadiness({
      workflowResult: createStandardWorkflowArtifact({
        summary: {
          ...createStandardWorkflowArtifact().summary,
          calculation: {
            ...createStandardWorkflowArtifact().summary.calculation,
            config: {
              ...createStandardWorkflowArtifact().summary.calculation.config,
              method: 'lifo',
            },
          },
        },
      }),
      scope: scope.value,
      metadata: {
        unknownTransactionClassificationCount: 3,
      },
    });

    expect(result.status).toBe('blocked');
    expect(result.blockingIssues.map((issue) => issue.code)).toEqual(['UNKNOWN_TRANSACTION_CLASSIFICATION']);
  });
});
