import type { Currency, UniversalTransactionData } from '@exitbook/core';
import { ok, parseDecimal } from '@exitbook/core';
import { describe, expect, it } from 'vitest';

import type { ICostBasisContextReader } from '../../ports/cost-basis-persistence.js';
import { createCanadaFxProvider } from '../canada/__tests__/test-utils.js';

import {
  buildCostBasisSnapshotRecord,
  containsOnlyPlainJson,
  readCostBasisSnapshotArtifact,
} from './cost-basis-artifact-storage.js';
import { CostBasisWorkflow } from './cost-basis-workflow.js';

const BTC = 'BTC' as Currency;
const CAD = 'CAD' as Currency;
const USD = 'USD' as Currency;

function createAcquisitionTransaction(params: {
  assetId: string;
  assetSymbol: Currency;
  id: number;
  priceCurrency: Currency;
  quantity: string;
  timestamp: string;
  unitPrice: string;
}): UniversalTransactionData {
  return {
    id: params.id,
    accountId: 1,
    externalId: `tx-${params.id}`,
    datetime: params.timestamp,
    timestamp: Date.parse(params.timestamp),
    source: 'kraken',
    sourceType: 'exchange',
    status: 'success',
    movements: {
      inflows: [
        {
          assetId: params.assetId,
          assetSymbol: params.assetSymbol,
          grossAmount: parseDecimal(params.quantity),
          priceAtTxTime: {
            price: { amount: parseDecimal(params.unitPrice), currency: params.priceCurrency },
            source: 'exchange-execution',
            fetchedAt: new Date(params.timestamp),
            granularity: 'exact',
          },
        },
      ],
      outflows: [],
    },
    fees: [],
    operation: { category: 'trade', type: 'buy' },
  };
}

function createDispositionTransaction(params: {
  assetId: string;
  assetSymbol: Currency;
  id: number;
  priceCurrency: Currency;
  quantity: string;
  timestamp: string;
  unitPrice: string;
}): UniversalTransactionData {
  return {
    id: params.id,
    accountId: 1,
    externalId: `tx-${params.id}`,
    datetime: params.timestamp,
    timestamp: Date.parse(params.timestamp),
    source: 'kraken',
    sourceType: 'exchange',
    status: 'success',
    movements: {
      inflows: [],
      outflows: [
        {
          assetId: params.assetId,
          assetSymbol: params.assetSymbol,
          grossAmount: parseDecimal(params.quantity),
          priceAtTxTime: {
            price: { amount: parseDecimal(params.unitPrice), currency: params.priceCurrency },
            source: 'exchange-execution',
            fetchedAt: new Date(params.timestamp),
            granularity: 'exact',
          },
        },
      ],
    },
    fees: [],
    operation: { category: 'trade', type: 'sell' },
  };
}

function createStore(transactions: UniversalTransactionData[]): ICostBasisContextReader {
  return {
    loadCostBasisContext: async () =>
      ok({
        transactions,
        confirmedLinks: [],
      }),
  };
}

describe('cost-basis-artifact-storage', () => {
  it('maps a generic workflow result to storage JSON and back', async () => {
    const transactions = [
      createAcquisitionTransaction({
        id: 1,
        assetId: 'exchange:kraken:btc',
        assetSymbol: BTC,
        timestamp: '2024-01-01T12:00:00Z',
        quantity: '1',
        unitPrice: '10000',
        priceCurrency: USD,
      }),
      createDispositionTransaction({
        id: 2,
        assetId: 'exchange:kraken:btc',
        assetSymbol: BTC,
        timestamp: '2024-02-01T12:00:00Z',
        quantity: '1',
        unitPrice: '12000',
        priceCurrency: USD,
      }),
    ];

    const workflow = new CostBasisWorkflow(createStore(transactions));
    const result = await workflow.execute(
      {
        config: {
          method: 'fifo',
          jurisdiction: 'US',
          taxYear: 2024,
          currency: 'USD',
          startDate: new Date('2024-01-01T00:00:00Z'),
          endDate: new Date('2024-12-31T23:59:59Z'),
        },
      },
      transactions
    );

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw result.error;
    }
    expect(result.value.kind).toBe('generic-pipeline');
    if (result.value.kind !== 'generic-pipeline') {
      throw new Error('Expected generic-pipeline workflow result');
    }

    const snapshotResult = buildCostBasisSnapshotRecord(
      result.value,
      {
        links: { status: 'fresh', lastBuiltAt: new Date('2026-03-14T12:00:00Z') },
        assetReview: { status: 'fresh', lastBuiltAt: new Date('2026-03-14T12:00:01Z') },
        pricesLastMutatedAt: new Date('2026-03-14T12:00:02Z'),
        exclusionFingerprint: 'excluded-assets:none',
      },
      'cost-basis:test'
    );

    expect(snapshotResult.isOk()).toBe(true);
    if (snapshotResult.isErr()) {
      throw snapshotResult.error;
    }

    expect(containsOnlyPlainJson(JSON.parse(snapshotResult.value.snapshot.artifactJson))).toBe(true);
    expect(containsOnlyPlainJson(JSON.parse(snapshotResult.value.snapshot.debugJson))).toBe(true);

    const reloadResult = readCostBasisSnapshotArtifact(snapshotResult.value.snapshot);
    expect(reloadResult.isOk()).toBe(true);
    if (reloadResult.isErr()) {
      throw reloadResult.error;
    }

    expect(reloadResult.value.artifact.kind).toBe('generic-pipeline');
    if (reloadResult.value.artifact.kind !== 'generic-pipeline') {
      throw new Error('Expected generic-pipeline artifact');
    }

    expect(reloadResult.value.artifact.summary.calculation.id).toBe(result.value.summary.calculation.id);
    expect(reloadResult.value.artifact.disposals[0]?.gainLoss.toFixed()).toBe('2000');
  });

  it('maps a canada workflow result to storage JSON and back', async () => {
    const transactions = [
      createAcquisitionTransaction({
        id: 1,
        assetId: 'exchange:kraken:btc',
        assetSymbol: BTC,
        timestamp: '2024-01-01T12:00:00Z',
        quantity: '1',
        unitPrice: '10000',
        priceCurrency: CAD,
      }),
      createDispositionTransaction({
        id: 2,
        assetId: 'exchange:kraken:btc',
        assetSymbol: BTC,
        timestamp: '2024-02-01T12:00:00Z',
        quantity: '1',
        unitPrice: '12000',
        priceCurrency: CAD,
      }),
    ];

    const workflow = new CostBasisWorkflow(
      createStore(transactions),
      createCanadaFxProvider({ fiatToUsd: { CAD: '0.75' } })
    );
    const result = await workflow.execute(
      {
        config: {
          method: 'average-cost',
          jurisdiction: 'CA',
          taxYear: 2024,
          currency: 'CAD',
          startDate: new Date('2024-01-01T00:00:00Z'),
          endDate: new Date('2024-12-31T23:59:59Z'),
        },
      },
      transactions
    );

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw result.error;
    }

    const snapshotResult = buildCostBasisSnapshotRecord(
      result.value,
      {
        links: { status: 'fresh', lastBuiltAt: new Date('2026-03-14T12:00:00Z') },
        assetReview: { status: 'fresh', lastBuiltAt: new Date('2026-03-14T12:00:01Z') },
        pricesLastMutatedAt: new Date('2026-03-14T12:00:02Z'),
        exclusionFingerprint: 'excluded-assets:none',
      },
      'cost-basis:test-ca'
    );

    expect(snapshotResult.isOk()).toBe(true);
    if (snapshotResult.isErr()) {
      throw snapshotResult.error;
    }

    expect(containsOnlyPlainJson(JSON.parse(snapshotResult.value.snapshot.artifactJson))).toBe(true);

    const reloadResult = readCostBasisSnapshotArtifact(snapshotResult.value.snapshot);
    expect(reloadResult.isOk()).toBe(true);
    if (reloadResult.isErr()) {
      throw reloadResult.error;
    }

    expect(reloadResult.value.artifact.kind).toBe('canada-workflow');
    if (reloadResult.value.artifact.kind !== 'canada-workflow') {
      throw new Error('Expected canada-workflow artifact');
    }
    const { displayReport } = reloadResult.value.artifact;
    if (!displayReport) {
      throw new Error('Expected canada display report');
    }

    expect(reloadResult.value.artifact.taxReport.summary.totalProceedsCad.toFixed()).toBe('12000');
    expect(displayReport.summary.totalTaxableGainLoss.toFixed()).toBe('1000');
  });
});
