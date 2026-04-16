import type { Account } from '@exitbook/core';
import { parseDecimal, type Currency } from '@exitbook/foundation';
import { assertOk } from '@exitbook/foundation/test-utils';

import { createLink, createTransaction } from '../../../linking/shared/test-utils.js';
import type { CostBasisContext } from '../../../ports/cost-basis-persistence.js';
import type { CostBasisWorkflowResult } from '../../workflow/workflow-result-types.js';
import type { TaxPackageBuildContext } from '../tax-package-build-context.js';
import { buildTaxPackageBuildContext } from '../tax-package-context-builder.js';

function createAccountFixture(
  id: number,
  accountType: Account['accountType'],
  platformKey: string,
  identifier: string
): Account {
  return {
    id,
    profileId: 1,
    accountType,
    platformKey,
    identifier,
    accountFingerprint: `acct:1:${accountType}:${platformKey}:${identifier}`,
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
  };
}

export function createStandardWorkflowArtifact(
  overrides?: Partial<Extract<CostBasisWorkflowResult, { kind: 'standard-workflow' }>>
): Extract<CostBasisWorkflowResult, { kind: 'standard-workflow' }> {
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
    lots: [],
    disposals: [],
    lotTransfers: [],
    executionMeta: {
      missingPricesCount: 0,
      retainedTransactionIds: [1, 2, 3],
    },
    ...overrides,
  };
}

export function createCanadaWorkflowArtifact(
  overrides?: Partial<Extract<CostBasisWorkflowResult, { kind: 'canada-workflow' }>>
): Extract<CostBasisWorkflowResult, { kind: 'canada-workflow' }> {
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
      acquisitions: [],
      dispositions: [],
      transfers: [],
      superficialLossAdjustments: [],
      summary: {
        totalProceedsCad: parseDecimal('36000'),
        totalCostBasisCad: parseDecimal('30000'),
        totalGainLossCad: parseDecimal('6000'),
        totalTaxableGainLossCad: parseDecimal('3000'),
        totalDeniedLossCad: parseDecimal('0'),
      },
      displayContext: {
        transferMarketValueCadByTransferId: new Map(),
      },
    },
    inputContext: {
      taxCurrency: 'CAD',
      inputTransactionIds: [10, 11],
      validatedTransferLinkIds: [],
      internalTransferCarryoverSourceTransactionIds: [],
      inputEvents: [],
    },
    executionMeta: {
      missingPricesCount: 0,
      retainedTransactionIds: [10, 11],
    },
    ...overrides,
  };
}

export function createCanadaPackageBuildContext(): TaxPackageBuildContext {
  const artifact = createCanadaWorkflowArtifact({
    taxReport: {
      calculationId: '0f93f130-e4d6-4d67-9458-84875b0f868a',
      taxCurrency: 'CAD',
      acquisitions: [
        {
          id: 'layer-1',
          acquisitionEventId: 'acq-1',
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
          dispositionEventId: 'disp-1',
          transactionId: 11,
          taxPropertyKey: 'BTC',
          assetSymbol: 'BTC' as Currency,
          disposedAt: new Date('2024-03-10T00:00:00.000Z'),
          quantityDisposed: parseDecimal('0.6'),
          proceedsCad: parseDecimal('36000'),
          costBasisCad: parseDecimal('30000'),
          gainLossCad: parseDecimal('6000'),
          deniedLossCad: parseDecimal('100'),
          taxableGainLossCad: parseDecimal('3050'),
          acbPerUnitCad: parseDecimal('50000'),
        },
      ],
      transfers: [
        {
          id: 'transfer-1',
          direction: 'internal',
          sourceTransferEventId: 'transfer-out-1',
          targetTransferEventId: 'transfer-in-1',
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
      superficialLossAdjustments: [
        {
          id: 'sla-1',
          adjustedAt: new Date('2024-03-15T00:00:00.000Z'),
          assetSymbol: 'BTC' as Currency,
          deniedLossCad: parseDecimal('100'),
          deniedQuantity: parseDecimal('0.1'),
          relatedDispositionId: 'disp-1',
          taxPropertyKey: 'BTC',
          substitutedPropertyAcquisitionId: 'layer-1',
        },
      ],
      summary: {
        totalProceedsCad: parseDecimal('36000'),
        totalCostBasisCad: parseDecimal('30000'),
        totalGainLossCad: parseDecimal('6000'),
        totalTaxableGainLossCad: parseDecimal('3050'),
        totalDeniedLossCad: parseDecimal('100'),
      },
      displayContext: {
        transferMarketValueCadByTransferId: new Map([['transfer-1', parseDecimal('12000')]]),
      },
    },
    inputContext: {
      taxCurrency: 'CAD',
      inputTransactionIds: [10, 11, 12],
      validatedTransferLinkIds: [9],
      internalTransferCarryoverSourceTransactionIds: [11],
      inputEvents: [
        {
          kind: 'acquisition',
          eventId: 'acq-1',
          transactionId: 10,
          timestamp: new Date('2024-01-10T00:00:00.000Z'),
          assetId: 'exchange:kraken:btc',
          assetIdentityKey: 'BTC',
          taxPropertyKey: 'BTC',
          assetSymbol: 'BTC' as Currency,
          valuation: createCanadaValuation('50000', '50000'),
          quantity: parseDecimal('1'),
          provenanceKind: 'movement',
        },
        {
          kind: 'disposition',
          eventId: 'disp-1',
          transactionId: 11,
          timestamp: new Date('2024-03-10T00:00:00.000Z'),
          assetId: 'exchange:kraken:btc',
          assetIdentityKey: 'BTC',
          taxPropertyKey: 'BTC',
          assetSymbol: 'BTC' as Currency,
          valuation: createCanadaValuation('60000', '36050'),
          quantity: parseDecimal('0.6'),
          proceedsReductionCad: parseDecimal('50'),
          provenanceKind: 'movement',
        },
        {
          kind: 'transfer-out',
          eventId: 'transfer-out-1',
          transactionId: 11,
          timestamp: new Date('2024-03-10T00:00:00.000Z'),
          assetId: 'exchange:kraken:btc',
          assetIdentityKey: 'BTC',
          taxPropertyKey: 'BTC',
          assetSymbol: 'BTC' as Currency,
          valuation: createCanadaValuation('60000', '12000'),
          quantity: parseDecimal('0.2'),
          provenanceKind: 'validated-link',
          linkId: 9,
          movementFingerprint: 'movement:exchange:source:11:btc:outflow:0',
        },
        {
          kind: 'transfer-in',
          eventId: 'transfer-in-1',
          transactionId: 12,
          timestamp: new Date('2024-03-10T00:00:00.000Z'),
          assetId: 'blockchain:bitcoin:native',
          assetIdentityKey: 'BTC',
          taxPropertyKey: 'BTC',
          assetSymbol: 'BTC' as Currency,
          valuation: createCanadaValuation('60000', '12000'),
          quantity: parseDecimal('0.2'),
          provenanceKind: 'validated-link',
          linkId: 9,
          sourceTransactionId: 11,
          sourceMovementFingerprint: 'movement:exchange:source:11:btc:outflow:0',
          targetMovementFingerprint: 'movement:blockchain:target:12:btc:inflow:0',
        },
      ],
    },
  });

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
        datetime: '2024-03-10T00:00:00.000Z',
        source: 'bitcoin',
        platformKind: 'blockchain',
        inflows: [{ amount: '0.2', assetSymbol: 'BTC', assetId: 'blockchain:bitcoin:native' }],
        blockchain: {
          name: 'bitcoin',
          transaction_hash: 'txhash-12',
          is_confirmed: true,
        },
      }),
    ],
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
    accounts: [
      createAccountFixture(1, 'exchange-api', 'kraken', 'primary-api'),
      createAccountFixture(2, 'blockchain', 'bitcoin', 'bc1qexamplewallet'),
    ],
  };

  return assertOk(
    buildTaxPackageBuildContext({
      artifact,
      sourceContext,
      scopeKey: 'scope:ca:2024',
      snapshotId: '4f52bbec-0ecd-441e-86b4-4202d55d33a3',
    })
  );
}

export function createStandardPackageBuildContext(): TaxPackageBuildContext {
  const baseArtifact = createStandardWorkflowArtifact();
  const artifact = createStandardWorkflowArtifact({
    summary: {
      ...baseArtifact.summary,
      calculation: {
        ...baseArtifact.summary.calculation,
        totalProceeds: parseDecimal('14925'),
        totalCostBasis: parseDecimal('16000'),
        totalGainLoss: parseDecimal('-1075'),
        totalTaxableGainLoss: parseDecimal('-30'),
        transactionsProcessed: 5,
        lotsCreated: 2,
        disposalsProcessed: 2,
      },
      lotsCreated: 2,
      disposalsProcessed: 2,
      totalCapitalGainLoss: parseDecimal('-1075'),
      totalTaxableGainLoss: parseDecimal('-30'),
    },
    lots: [
      {
        id: 'lot-1',
        calculationId: baseArtifact.summary.calculation.id,
        acquisitionTransactionId: 1,
        assetId: 'exchange:kraken:btc',
        assetSymbol: 'BTC' as Currency,
        quantity: parseDecimal('1'),
        costBasisPerUnit: parseDecimal('10000'),
        totalCostBasis: parseDecimal('10000'),
        acquisitionDate: new Date('2023-01-05T00:00:00.000Z'),
        method: 'fifo',
        remainingQuantity: parseDecimal('0'),
        status: 'fully_disposed',
        createdAt: new Date('2026-03-15T12:00:00.000Z'),
        updatedAt: new Date('2026-03-15T12:00:00.000Z'),
      },
      {
        id: 'lot-2',
        calculationId: baseArtifact.summary.calculation.id,
        acquisitionTransactionId: 2,
        assetId: 'exchange:kraken:btc',
        assetSymbol: 'BTC' as Currency,
        quantity: parseDecimal('1'),
        costBasisPerUnit: parseDecimal('15000'),
        totalCostBasis: parseDecimal('15000'),
        acquisitionDate: new Date('2024-06-01T00:00:00.000Z'),
        method: 'fifo',
        remainingQuantity: parseDecimal('0.35'),
        status: 'partially_disposed',
        createdAt: new Date('2026-03-15T12:00:00.000Z'),
        updatedAt: new Date('2026-03-15T12:00:00.000Z'),
      },
    ],
    disposals: [
      {
        id: 'disp-1',
        lotId: 'lot-1',
        disposalTransactionId: 3,
        quantityDisposed: parseDecimal('1'),
        proceedsPerUnit: parseDecimal('9000'),
        totalProceeds: parseDecimal('8955'),
        grossProceeds: parseDecimal('9000'),
        sellingExpenses: parseDecimal('45'),
        netProceeds: parseDecimal('8955'),
        costBasisPerUnit: parseDecimal('10000'),
        totalCostBasis: parseDecimal('10000'),
        gainLoss: parseDecimal('-1045'),
        disposalDate: new Date('2024-11-01T00:00:00.000Z'),
        holdingPeriodDays: 666,
        lossDisallowed: true,
        disallowedLossAmount: parseDecimal('1045'),
        taxTreatmentCategory: 'long_term',
        createdAt: new Date('2026-03-15T12:00:00.000Z'),
      },
      {
        id: 'disp-2',
        lotId: 'lot-2',
        disposalTransactionId: 3,
        quantityDisposed: parseDecimal('0.4'),
        proceedsPerUnit: parseDecimal('15000'),
        totalProceeds: parseDecimal('5970'),
        grossProceeds: parseDecimal('6000'),
        sellingExpenses: parseDecimal('30'),
        netProceeds: parseDecimal('5970'),
        costBasisPerUnit: parseDecimal('15000'),
        totalCostBasis: parseDecimal('6000'),
        gainLoss: parseDecimal('-30'),
        disposalDate: new Date('2024-11-01T00:00:00.000Z'),
        holdingPeriodDays: 153,
        lossDisallowed: false,
        taxTreatmentCategory: 'short_term',
        createdAt: new Date('2026-03-15T12:00:00.000Z'),
      },
    ],
    lotTransfers: [
      {
        id: 'transfer-1',
        calculationId: baseArtifact.summary.calculation.id,
        sourceLotId: 'lot-2',
        provenance: {
          kind: 'confirmed-link',
          linkId: 11,
          sourceMovementFingerprint: 'movement:exchange:source:4:btc:outflow:0',
          targetMovementFingerprint: 'movement:blockchain:target:5:btc:inflow:0',
        },
        quantityTransferred: parseDecimal('0.25'),
        costBasisPerUnit: parseDecimal('15000'),
        sourceTransactionId: 4,
        targetTransactionId: 5,
        transferDate: new Date('2024-12-15T00:00:00.000Z'),
        metadata: {
          sameAssetFeeUsdValue: parseDecimal('12.50'),
        },
        createdAt: new Date('2026-03-15T12:00:00.000Z'),
      },
    ],
    executionMeta: {
      missingPricesCount: 0,
      retainedTransactionIds: [1, 2, 3, 4, 5],
    },
  });

  const sourceContext: CostBasisContext = {
    transactions: [
      createTransaction({
        id: 1,
        accountId: 1,
        datetime: '2023-01-05T00:00:00.000Z',
        source: 'kraken',
        inflows: [{ amount: '1', assetSymbol: 'BTC', assetId: 'exchange:kraken:btc' }],
      }),
      createTransaction({
        id: 2,
        accountId: 1,
        datetime: '2024-06-01T00:00:00.000Z',
        source: 'kraken',
        inflows: [{ amount: '1', assetSymbol: 'BTC', assetId: 'exchange:kraken:btc' }],
      }),
      createTransaction({
        id: 3,
        accountId: 2,
        datetime: '2024-11-01T00:00:00.000Z',
        source: 'kraken',
        outflows: [{ amount: '1.4', assetSymbol: 'BTC', assetId: 'exchange:kraken:btc' }],
      }),
      createTransaction({
        id: 4,
        accountId: 2,
        datetime: '2024-12-15T00:00:00.000Z',
        source: 'kraken',
        outflows: [{ amount: '0.25', assetSymbol: 'BTC', assetId: 'exchange:kraken:btc' }],
      }),
      createTransaction({
        id: 5,
        accountId: 3,
        datetime: '2024-12-15T00:00:00.000Z',
        source: 'bitcoin',
        platformKind: 'blockchain',
        inflows: [{ amount: '0.25', assetSymbol: 'BTC', assetId: 'blockchain:bitcoin:native' }],
        blockchain: {
          name: 'bitcoin',
          transaction_hash: 'txhash-5',
          is_confirmed: true,
        },
      }),
    ],
    confirmedLinks: [
      createLink({
        id: 11,
        sourceTransactionId: 4,
        targetTransactionId: 5,
        assetSymbol: 'BTC',
        sourceAmount: parseDecimal('0.25'),
        targetAmount: parseDecimal('0.25'),
      }),
    ],
    accounts: [
      createAccountFixture(1, 'exchange-api', 'kraken', 'spot-wallet'),
      createAccountFixture(2, 'exchange-api', 'kraken', 'trading-wallet'),
      createAccountFixture(3, 'blockchain', 'bitcoin', 'bc1qstandardtestwallet'),
    ],
  };

  return assertOk(
    buildTaxPackageBuildContext({
      artifact,
      sourceContext,
      scopeKey: 'scope:us:2024',
      snapshotId: 'aab94276-851c-44e3-b7c1-54c22f6a1435',
    })
  );
}

function createCanadaValuation(unitValueCad: string, totalValueCad: string) {
  return {
    taxCurrency: 'CAD' as const,
    storagePriceAmount: parseDecimal(unitValueCad),
    storagePriceCurrency: 'USD' as Currency,
    quotedPriceAmount: parseDecimal(unitValueCad),
    quotedPriceCurrency: 'CAD' as Currency,
    unitValueCad: parseDecimal(unitValueCad),
    totalValueCad: parseDecimal(totalValueCad),
    valuationSource: 'quoted-price' as const,
  };
}
