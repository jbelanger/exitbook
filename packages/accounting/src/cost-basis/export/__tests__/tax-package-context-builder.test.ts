import type { Account } from '@exitbook/core';
import { parseDecimal, type Currency } from '@exitbook/foundation';
import { describe, expect, it } from 'vitest';

import { createLink, createTransaction } from '../../../linking/shared/test-utils.js';
import type { CostBasisContext } from '../../../ports/cost-basis-persistence.js';
import type { CostBasisWorkflowResult } from '../../workflow/workflow-result-types.js';
import { buildTaxPackageBuildContext } from '../tax-package-context-builder.js';

function createAccount(id: number, platformKey = `account-${id}`): Account {
  return {
    id,
    accountType: 'exchange-api',
    platformKey,
    identifier: `${platformKey}-identifier`,
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
  };
}

function createStandardArtifact(): Extract<CostBasisWorkflowResult, { kind: 'standard-workflow' }> {
  return {
    kind: 'standard-workflow',
    summary: {
      calculation: {
        id: 'df94bdd2-b8ee-4486-9c83-b0f91ca62514',
        calculationDate: new Date('2026-03-15T12:00:00.000Z'),
        config: {
          method: 'fifo',
          currency: 'USD',
          jurisdiction: 'US',
          taxYear: 2024,
          startDate: new Date('2024-01-01T00:00:00.000Z'),
          endDate: new Date('2024-12-31T23:59:59.999Z'),
        },
        startDate: new Date('2024-01-01T00:00:00.000Z'),
        endDate: new Date('2024-12-31T23:59:59.999Z'),
        totalProceeds: parseDecimal('12000'),
        totalCostBasis: parseDecimal('10000'),
        totalGainLoss: parseDecimal('2000'),
        totalTaxableGainLoss: parseDecimal('2000'),
        assetsProcessed: ['BTC'],
        transactionsProcessed: 3,
        lotsCreated: 1,
        disposalsProcessed: 1,
        status: 'completed',
        createdAt: new Date('2026-03-15T12:00:00.000Z'),
        completedAt: new Date('2026-03-15T12:00:00.000Z'),
      },
      lotsCreated: 1,
      disposalsProcessed: 1,
      totalCapitalGainLoss: parseDecimal('2000'),
      totalTaxableGainLoss: parseDecimal('2000'),
      assetsProcessed: ['BTC'],
      lots: [],
      disposals: [],
      lotTransfers: [],
    },
    lots: [
      {
        id: 'd3feb56c-34db-4579-baa5-37bc3f17ca23',
        calculationId: 'df94bdd2-b8ee-4486-9c83-b0f91ca62514',
        acquisitionTransactionId: 1,
        assetId: 'exchange:kraken:btc',
        assetSymbol: 'BTC' as Currency,
        quantity: parseDecimal('1'),
        costBasisPerUnit: parseDecimal('10000'),
        totalCostBasis: parseDecimal('10000'),
        acquisitionDate: new Date('2024-01-05T00:00:00.000Z'),
        method: 'fifo',
        remainingQuantity: parseDecimal('0'),
        status: 'fully_disposed',
        createdAt: new Date('2026-03-15T12:00:00.000Z'),
        updatedAt: new Date('2026-03-15T12:00:00.000Z'),
      },
    ],
    disposals: [
      {
        id: '2bd2f52c-4646-4eb6-af8d-7155dd1fbe65',
        lotId: 'd3feb56c-34db-4579-baa5-37bc3f17ca23',
        disposalTransactionId: 2,
        quantityDisposed: parseDecimal('1'),
        proceedsPerUnit: parseDecimal('12000'),
        totalProceeds: parseDecimal('11950'),
        grossProceeds: parseDecimal('12000'),
        sellingExpenses: parseDecimal('50'),
        netProceeds: parseDecimal('11950'),
        costBasisPerUnit: parseDecimal('10000'),
        totalCostBasis: parseDecimal('10000'),
        gainLoss: parseDecimal('1950'),
        disposalDate: new Date('2024-02-01T00:00:00.000Z'),
        holdingPeriodDays: 27,
        lossDisallowed: false,
        createdAt: new Date('2026-03-15T12:00:00.000Z'),
      },
    ],
    lotTransfers: [
      {
        id: 'c39bf01b-a561-4704-8047-d9728c85035f',
        calculationId: 'df94bdd2-b8ee-4486-9c83-b0f91ca62514',
        sourceLotId: 'd3feb56c-34db-4579-baa5-37bc3f17ca23',
        provenance: {
          kind: 'confirmed-link',
          linkId: 7,
          sourceMovementFingerprint: 'movement:exchange:source:2:btc:outflow:0',
          targetMovementFingerprint: 'movement:blockchain:target:3:btc:inflow:0',
        },
        quantityTransferred: parseDecimal('0.25'),
        costBasisPerUnit: parseDecimal('10000'),
        sourceTransactionId: 2,
        targetTransactionId: 3,
        transferDate: new Date('2024-02-01T00:00:00.000Z'),
        createdAt: new Date('2026-03-15T12:00:00.000Z'),
      },
    ],
    executionMeta: {
      missingPricesCount: 0,
      retainedTransactionIds: [1, 2, 3],
    },
  };
}

function createCanadaArtifact(): Extract<CostBasisWorkflowResult, { kind: 'canada-workflow' }> {
  return {
    kind: 'canada-workflow',
    calculation: {
      id: '0f93f130-e4d6-4d67-9458-84875b0f868a',
      calculationDate: new Date('2026-03-15T12:00:00.000Z'),
      method: 'average-cost',
      jurisdiction: 'CA',
      taxYear: 2024,
      displayCurrency: 'CAD' as Currency,
      taxCurrency: 'CAD',
      startDate: new Date('2024-01-01T00:00:00.000Z'),
      endDate: new Date('2024-12-31T23:59:59.999Z'),
      transactionsProcessed: 2,
      assetsProcessed: ['BTC'],
    },
    taxReport: {
      calculationId: '0f93f130-e4d6-4d67-9458-84875b0f868a',
      taxCurrency: 'CAD',
      acquisitions: [
        {
          id: 'acq-1',
          acquisitionEventId: 'evt-acq-1',
          transactionId: 10,
          taxPropertyKey: 'BTC',
          assetSymbol: 'BTC' as Currency,
          acquiredAt: new Date('2024-01-10T00:00:00.000Z'),
          quantityAcquired: parseDecimal('1'),
          remainingQuantity: parseDecimal('0.4'),
          totalCostCad: parseDecimal('50000'),
          remainingAllocatedAcbCad: parseDecimal('20000'),
          costBasisPerUnitCad: parseDecimal('50000'),
        },
      ],
      dispositions: [
        {
          id: 'disp-1',
          dispositionEventId: 'evt-disp-1',
          transactionId: 11,
          taxPropertyKey: 'BTC',
          assetSymbol: 'BTC' as Currency,
          disposedAt: new Date('2024-03-10T00:00:00.000Z'),
          quantityDisposed: parseDecimal('0.6'),
          proceedsCad: parseDecimal('36000'),
          costBasisCad: parseDecimal('30000'),
          gainLossCad: parseDecimal('6000'),
          deniedLossCad: parseDecimal('0'),
          taxableGainLossCad: parseDecimal('3000'),
          acbPerUnitCad: parseDecimal('50000'),
        },
      ],
      transfers: [
        {
          id: 'transfer-1',
          direction: 'internal',
          sourceTransferEventId: 'evt-transfer-out-1',
          targetTransferEventId: 'evt-transfer-in-1',
          sourceTransactionId: 11,
          targetTransactionId: 12,
          linkId: 9,
          transactionId: 11,
          taxPropertyKey: 'BTC',
          assetSymbol: 'BTC' as Currency,
          transferredAt: new Date('2024-03-10T00:00:00.000Z'),
          quantity: parseDecimal('0.2'),
          carriedAcbCad: parseDecimal('10000'),
          carriedAcbPerUnitCad: parseDecimal('50000'),
          feeAdjustmentCad: parseDecimal('25'),
        },
      ],
      superficialLossAdjustments: [],
      summary: {
        totalProceedsCad: parseDecimal('36000'),
        totalCostBasisCad: parseDecimal('30000'),
        totalGainLossCad: parseDecimal('6000'),
        totalTaxableGainLossCad: parseDecimal('3000'),
        totalDeniedLossCad: parseDecimal('0'),
      },
      displayContext: {
        transferMarketValueCadByTransferId: new Map([['transfer-1', parseDecimal('12000')]]),
      },
    },
    inputContext: {
      taxCurrency: 'CAD',
      scopedTransactionIds: [10, 11, 12],
      validatedTransferLinkIds: [9],
      feeOnlyInternalCarryoverSourceTransactionIds: [11],
      inputEvents: [
        {
          kind: 'acquisition',
          eventId: 'evt-acq-1',
          transactionId: 10,
          timestamp: new Date('2024-01-10T00:00:00.000Z'),
          assetId: 'exchange:kraken:btc',
          assetIdentityKey: 'BTC',
          taxPropertyKey: 'BTC',
          assetSymbol: 'BTC' as Currency,
          valuation: {
            taxCurrency: 'CAD',
            storagePriceAmount: parseDecimal('37000'),
            storagePriceCurrency: 'USD' as Currency,
            quotedPriceAmount: parseDecimal('50000'),
            quotedPriceCurrency: 'CAD' as Currency,
            unitValueCad: parseDecimal('50000'),
            totalValueCad: parseDecimal('50000'),
            valuationSource: 'fiat-to-cad-fx',
            fxRateToCad: parseDecimal('1.35'),
            fxSource: 'test',
            fxTimestamp: new Date('2024-01-10T00:00:00.000Z'),
          },
          provenanceKind: 'scoped-movement',
          quantity: parseDecimal('1'),
        },
        {
          kind: 'transfer-out',
          eventId: 'evt-transfer-out-1',
          transactionId: 11,
          timestamp: new Date('2024-03-10T00:00:00.000Z'),
          assetId: 'exchange:kraken:btc',
          assetIdentityKey: 'BTC',
          taxPropertyKey: 'BTC',
          assetSymbol: 'BTC' as Currency,
          valuation: {
            taxCurrency: 'CAD',
            storagePriceAmount: parseDecimal('45000'),
            storagePriceCurrency: 'USD' as Currency,
            quotedPriceAmount: parseDecimal('60000'),
            quotedPriceCurrency: 'CAD' as Currency,
            unitValueCad: parseDecimal('60000'),
            totalValueCad: parseDecimal('12000'),
            valuationSource: 'fiat-to-cad-fx',
            fxRateToCad: parseDecimal('1.33'),
            fxSource: 'test',
            fxTimestamp: new Date('2024-03-10T00:00:00.000Z'),
          },
          provenanceKind: 'validated-link',
          linkId: 9,
          sourceTransactionId: 11,
          quantity: parseDecimal('0.2'),
        },
      ],
    },
    executionMeta: {
      missingPricesCount: 0,
      retainedTransactionIds: [10, 11, 12],
    },
  };
}

describe('buildTaxPackageBuildContext', () => {
  it('builds deterministic lookup maps for standard workflow artifacts', () => {
    const artifact = createStandardArtifact();
    const sourceContext: CostBasisContext = {
      transactions: [
        createTransaction({
          id: 3,
          accountId: 2,
          datetime: '2024-02-01T01:00:00.000Z',
          source: 'wallet',
          platformKind: 'blockchain',
          inflows: [{ amount: '0.25', assetSymbol: 'BTC' }],
        }),
        createTransaction({
          id: 1,
          accountId: 1,
          datetime: '2024-01-05T00:00:00.000Z',
          source: 'kraken',
          inflows: [{ amount: '1', assetSymbol: 'BTC' }],
        }),
        createTransaction({
          id: 2,
          accountId: 1,
          datetime: '2024-02-01T00:00:00.000Z',
          source: 'kraken',
          outflows: [{ amount: '1', assetSymbol: 'BTC' }],
        }),
      ],
      accounts: [createAccount(2, 'wallet'), createAccount(1, 'kraken')],
      confirmedLinks: [
        createLink({
          id: 7,
          sourceTransactionId: 2,
          targetTransactionId: 3,
          assetSymbol: 'BTC',
          sourceAmount: parseDecimal('0.25'),
          targetAmount: parseDecimal('0.25'),
        }),
      ],
    };

    const result = buildTaxPackageBuildContext({
      artifact,
      sourceContext,
      scopeKey: 'cost-basis:US:fifo:2024',
      snapshotId: 'snapshot-1',
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw result.error;
    }

    expect(result.value.artifactRef).toEqual({
      calculationId: artifact.summary.calculation.id,
      scopeKey: 'cost-basis:US:fifo:2024',
      snapshotId: 'snapshot-1',
    });
    expect(Array.from(result.value.sourceContext.transactionsById.keys())).toEqual([1, 2, 3]);
    expect(Array.from(result.value.sourceContext.accountsById.keys())).toEqual([1, 2]);
    expect(Array.from(result.value.sourceContext.confirmedLinksById.keys())).toEqual([7]);
  });

  it('builds deterministic lookup maps for Canada workflow artifacts', () => {
    const artifact = createCanadaArtifact();
    const sourceContext: CostBasisContext = {
      transactions: [
        createTransaction({
          id: 12,
          accountId: 2,
          datetime: '2024-03-10T00:05:00.000Z',
          source: 'wallet',
          platformKind: 'blockchain',
          inflows: [{ amount: '0.2', assetSymbol: 'BTC' }],
        }),
        createTransaction({
          id: 10,
          accountId: 1,
          datetime: '2024-01-10T00:00:00.000Z',
          source: 'kraken',
          inflows: [{ amount: '1', assetSymbol: 'BTC' }],
        }),
        createTransaction({
          id: 11,
          accountId: 1,
          datetime: '2024-03-10T00:00:00.000Z',
          source: 'kraken',
          outflows: [{ amount: '0.8', assetSymbol: 'BTC' }],
        }),
      ],
      accounts: [createAccount(2, 'wallet'), createAccount(1, 'kraken')],
      confirmedLinks: [
        createLink({
          id: 9,
          sourceTransactionId: 11,
          targetTransactionId: 12,
          assetSymbol: 'BTC',
          sourceAmount: parseDecimal('0.2'),
          targetAmount: parseDecimal('0.2'),
        }),
      ],
    };

    const result = buildTaxPackageBuildContext({
      artifact,
      sourceContext,
      scopeKey: 'cost-basis:CA:average-cost:2024',
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw result.error;
    }

    expect(result.value.artifactRef.calculationId).toBe(artifact.calculation.id);
    expect(Array.from(result.value.sourceContext.transactionsById.keys())).toEqual([10, 11, 12]);
    expect(Array.from(result.value.sourceContext.accountsById.keys())).toEqual([1, 2]);
    expect(Array.from(result.value.sourceContext.confirmedLinksById.keys())).toEqual([9]);
  });

  it('fails when a referenced source transaction is missing', () => {
    const artifact = createStandardArtifact();
    const sourceContext: CostBasisContext = {
      transactions: [
        createTransaction({
          id: 1,
          accountId: 1,
          datetime: '2024-01-05T00:00:00.000Z',
          source: 'kraken',
          inflows: [{ amount: '1', assetSymbol: 'BTC' }],
        }),
      ],
      accounts: [createAccount(1, 'kraken')],
      confirmedLinks: [],
    };

    const result = buildTaxPackageBuildContext({
      artifact,
      sourceContext,
      scopeKey: 'cost-basis:US:fifo:2024',
    });

    expect(result.isErr()).toBe(true);
    if (result.isOk()) {
      throw new Error('Expected missing transaction validation to fail');
    }

    expect(result.error.message).toBe(
      'Missing source transaction 2 for standard disposal 2bd2f52c-4646-4eb6-af8d-7155dd1fbe65'
    );
  });

  it('fails when a referenced account is missing', () => {
    const artifact = createCanadaArtifact();
    const sourceContext: CostBasisContext = {
      transactions: [
        createTransaction({
          id: 10,
          accountId: 1,
          datetime: '2024-01-10T00:00:00.000Z',
          source: 'kraken',
          inflows: [{ amount: '1', assetSymbol: 'BTC' }],
        }),
        createTransaction({
          id: 11,
          accountId: 1,
          datetime: '2024-03-10T00:00:00.000Z',
          source: 'kraken',
          outflows: [{ amount: '0.8', assetSymbol: 'BTC' }],
        }),
        createTransaction({
          id: 12,
          accountId: 2,
          datetime: '2024-03-10T00:05:00.000Z',
          source: 'wallet',
          platformKind: 'blockchain',
          inflows: [{ amount: '0.2', assetSymbol: 'BTC' }],
        }),
      ],
      accounts: [createAccount(1, 'kraken')],
      confirmedLinks: [
        createLink({
          id: 9,
          sourceTransactionId: 11,
          targetTransactionId: 12,
          assetSymbol: 'BTC',
          sourceAmount: parseDecimal('0.2'),
          targetAmount: parseDecimal('0.2'),
        }),
      ],
    };

    const result = buildTaxPackageBuildContext({
      artifact,
      sourceContext,
      scopeKey: 'cost-basis:CA:average-cost:2024',
    });

    expect(result.isErr()).toBe(true);
    if (result.isOk()) {
      throw new Error('Expected missing account validation to fail');
    }

    expect(result.error.message).toBe(
      'Missing account 2 for source transaction 12 referenced by Canada transfer transfer-1 target'
    );
  });

  it('fails when a required confirmed link is missing', () => {
    const artifact = createStandardArtifact();
    const sourceContext: CostBasisContext = {
      transactions: [
        createTransaction({
          id: 1,
          accountId: 1,
          datetime: '2024-01-05T00:00:00.000Z',
          source: 'kraken',
          inflows: [{ amount: '1', assetSymbol: 'BTC' }],
        }),
        createTransaction({
          id: 2,
          accountId: 1,
          datetime: '2024-02-01T00:00:00.000Z',
          source: 'kraken',
          outflows: [{ amount: '1', assetSymbol: 'BTC' }],
        }),
        createTransaction({
          id: 3,
          accountId: 2,
          datetime: '2024-02-01T01:00:00.000Z',
          source: 'wallet',
          platformKind: 'blockchain',
          inflows: [{ amount: '0.25', assetSymbol: 'BTC' }],
        }),
      ],
      accounts: [createAccount(1, 'kraken'), createAccount(2, 'wallet')],
      confirmedLinks: [],
    };

    const result = buildTaxPackageBuildContext({
      artifact,
      sourceContext,
      scopeKey: 'cost-basis:US:fifo:2024',
    });

    expect(result.isErr()).toBe(true);
    if (result.isOk()) {
      throw new Error('Expected missing confirmed link validation to fail');
    }

    expect(result.error.message).toBe(
      'Missing confirmed link 7 for standard transfer c39bf01b-a561-4704-8047-d9728c85035f'
    );
  });
});
