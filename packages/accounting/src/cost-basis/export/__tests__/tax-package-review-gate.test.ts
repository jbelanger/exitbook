import { describe, expect, it } from 'vitest';

import { evaluateTaxPackageReadiness } from '../tax-package-review-gate.js';
import { validateTaxPackageScope } from '../tax-package-scope-validator.js';

import { createCanadaWorkflowArtifact, createStandardWorkflowArtifact } from './test-utils.js';

describe('evaluateTaxPackageReadiness', () => {
  it('returns ready when there are no blocking or warning issues', () => {
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
    expect(result.warnings).toEqual([]);
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
    expect(result.blockingIssues[0]?.recommendedAction).toBe(
      'Enrich or set the missing prices, then rerun the package export.'
    );
  });

  it('keeps export ready when only warning issues remain', () => {
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

    expect(result.status).toBe('ready');
    expect(result.blockingIssues).toEqual([]);
    expect(result.warnings.map((issue) => issue.code)).toEqual(['FX_FALLBACK_USED', 'INCOMPLETE_TRANSFER_LINKING']);
    expect(result.warnings[0]?.recommendedAction).toBe(
      'Review the FX conversions and confirm the fallback treatment is acceptable.'
    );
  });

  it('keeps blocked status when warning and blocking issues are both present', () => {
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
    expect(result.warnings.map((issue) => issue.code)).toEqual(['FX_FALLBACK_USED']);
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
        unknownTransactionClassificationCount: 1,
        unknownTransactionClassificationDetails: [
          {
            noteMessage:
              'Kraken group TSDEF5I-HNFS4-PZQ2KE has complex multi-leg fund flow and was materialized conservatively as a transfer.',
            noteType: 'classification_uncertain',
            operationCategory: 'transfer',
            operationType: 'transfer',
            reference: 'LI54ES-YRZMF-F2MYUQ',
            sourceName: 'kraken',
            transactionDatetime: '2023-11-28T04:59:06.764Z',
            transactionId: 2926,
          },
        ],
      },
    });

    expect(result.status).toBe('blocked');
    expect(result.blockingIssues.map((issue) => issue.code)).toEqual(['UNKNOWN_TRANSACTION_CLASSIFICATION']);
    expect(result.blockingIssues[0]?.summary).toBe(
      'A retained transaction still has unresolved operation classification.'
    );
    expect(result.blockingIssues[0]?.affectedArtifact).toBe('source transaction');
    expect(result.blockingIssues[0]?.affectedRowRef).toBe('LI54ES-YRZMF-F2MYUQ');
    expect(result.blockingIssues[0]?.details).toContain('kraken LI54ES-YRZMF-F2MYUQ');
    expect(result.blockingIssues[0]?.details).toContain('materialized as transfer/transfer');
    expect(result.blockingIssues[0]?.recommendedAction).toBe(
      'Review the transaction operation classification (for example transfer, swap, reward, or fee) before filing.'
    );
  });

  it('emits uncertain proceeds allocation as a warning', () => {
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
        allocationUncertainCount: 1,
        allocationUncertainDetails: [
          {
            noteMessage:
              'Kraken dustsweeping group TSDEF5I-HNFS4-PZQ2KE was classified as a dust conversion, but Kraken does not provide an exact per-asset proceeds allocation across every disposed asset in the group.',
            noteType: 'allocation_uncertain',
            operationCategory: 'trade',
            operationType: 'swap',
            reference: 'LI54ES-YRZMF-F2MYUQ',
            sourceName: 'kraken',
            transactionDatetime: '2023-11-28T04:59:06.764Z',
            transactionId: 2926,
          },
        ],
      },
    });

    expect(result.status).toBe('ready');
    expect(result.blockingIssues).toEqual([]);
    expect(result.warnings.map((issue) => issue.code)).toEqual(['UNCERTAIN_PROCEEDS_ALLOCATION']);
    expect(result.warnings[0]?.affectedArtifact).toBe('source transaction');
    expect(result.warnings[0]?.affectedRowRef).toBe('LI54ES-YRZMF-F2MYUQ');
    expect(result.warnings[0]?.details).toContain('exact per-asset proceeds allocation');
    expect(result.warnings[0]?.recommendedAction).toBe(
      'Inspect the source transaction if exact per-asset proceeds allocation matters for filing.'
    );
  });
});
