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
          missingPriceTransactionIds: [9, 10],
          retainedTransactionIds: [1, 2, 3],
        },
      }),
      scope: scope.value,
      metadata: {
        missingPriceDetails: [
          {
            platformKey: 'kraken',
            reference: 'TXREF-1',
            transactionDatetime: '2024-02-03T12:00:00.000Z',
            transactionId: 9,
            missingItems: [{ kind: 'outflow', assetSymbol: 'BTC' }],
          },
          {
            platformKey: 'kraken',
            reference: 'TXREF-2',
            transactionDatetime: '2024-02-04T12:00:00.000Z',
            transactionId: 10,
            missingItems: [
              { kind: 'fee', assetSymbol: 'ETH' },
              { kind: 'inflow', assetSymbol: 'USDT' },
            ],
          },
        ],
      },
    });

    expect(result.status).toBe('blocked');
    expect(result.blockingIssues).toHaveLength(2);
    expect(result.blockingIssues[0]?.code).toBe('MISSING_PRICE_DATA');
    expect(result.blockingIssues[0]?.affectedArtifact).toBe('source transaction');
    expect(result.blockingIssues[0]?.affectedRowRef).toBe('TXREF-1');
    expect(result.blockingIssues[0]?.details).toContain('outflow BTC');
    expect(result.blockingIssues[1]?.details).toContain('fee ETH, inflow USDT');
    expect(result.blockingIssues[0]?.recommendedAction).toBe(
      'Enrich or set the missing prices, then rerun the package export.'
    );
  });

  it('fails loudly when missing-price count is not backed by transaction detail', () => {
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

    expect(() =>
      evaluateTaxPackageReadiness({
        workflowResult: createStandardWorkflowArtifact({
          executionMeta: {
            missingPricesCount: 1,
            missingPriceTransactionIds: [9],
            retainedTransactionIds: [1, 2, 3],
          },
        }),
        scope: scope.value,
        metadata: {
          missingPriceDetails: [],
        },
      })
    ).toThrow(/Missing-price readiness detail count/);
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
            diagnosticCode: 'classification_uncertain',
            diagnosticMessage:
              'Kraken group TSDEF5I-HNFS4-PZQ2KE has complex multi-leg fund flow and was materialized conservatively as a transfer.',
            operationGroup: 'transfer',
            operationLabel: 'bridge/send',
            reference: 'LI54ES-YRZMF-F2MYUQ',
            platformKey: 'kraken',
            transactionDatetime: '2023-11-28T04:59:06.764Z',
            transactionId: 2926,
          },
        ],
      },
    });

    expect(result.status).toBe('blocked');
    expect(result.blockingIssues.map((issue) => issue.code)).toEqual(['UNKNOWN_TRANSACTION_CLASSIFICATION']);
    expect(result.blockingIssues[0]?.summary).toBe(
      'A tax-relevant transaction still has unresolved operation classification.'
    );
    expect(result.blockingIssues[0]?.affectedArtifact).toBe('source transaction');
    expect(result.blockingIssues[0]?.affectedRowRef).toBe('LI54ES-YRZMF-F2MYUQ');
    expect(result.blockingIssues[0]?.details).toContain('Tax-relevant transaction kraken LI54ES-YRZMF-F2MYUQ');
    expect(result.blockingIssues[0]?.details).toContain('interpreted as bridge/send');
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
            diagnosticCode: 'allocation_uncertain',
            diagnosticMessage:
              'Kraken dustsweeping group TSDEF5I-HNFS4-PZQ2KE was classified as a dust conversion, but Kraken does not provide an exact per-asset proceeds allocation across every disposed asset in the group.',
            operationGroup: 'trade',
            operationLabel: 'trade/swap',
            reference: 'LI54ES-YRZMF-F2MYUQ',
            platformKey: 'kraken',
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
