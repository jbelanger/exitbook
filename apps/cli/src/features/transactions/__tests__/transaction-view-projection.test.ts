import type { Transaction } from '@exitbook/core';
import { parseDecimal, type Currency } from '@exitbook/foundation';
import type { TransactionAnnotation } from '@exitbook/transaction-interpretation';
import { describe, expect, it } from 'vitest';

import { toTransactionViewItem } from '../transaction-view-projection.js';

function createTransaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: 1,
    accountId: 1,
    txFingerprint: 'coinbase:trade:swap-1',
    datetime: '2024-11-13T03:27:00.000Z',
    timestamp: Date.parse('2024-11-13T03:27:00.000Z'),
    platformKey: 'coinbase',
    platformKind: 'exchange',
    status: 'success',
    operation: { category: 'trade', type: 'swap' },
    movements: {
      inflows: [
        {
          assetId: 'asset:btc',
          assetSymbol: 'BTC' as Currency,
          movementFingerprint: 'inflow:btc:1',
          grossAmount: parseDecimal('0.0035'),
          netAmount: parseDecimal('0.0035'),
        },
      ],
      outflows: [
        {
          assetId: 'asset:cad',
          assetSymbol: 'CAD' as Currency,
          movementFingerprint: 'outflow:cad:1',
          grossAmount: parseDecimal('250'),
          netAmount: parseDecimal('250'),
        },
      ],
    },
    fees: [],
    diagnostics: [],
    userNotes: [],
    ...overrides,
  };
}

describe('toTransactionViewItem', () => {
  it('includes debit and credit summaries for two-sided trades', () => {
    const item = toTransactionViewItem(createTransaction());

    expect(item.operationGroup).toBe('trade');
    expect(item.operationLabel).toBe('trade/swap');
    expect(item.debitSummary).toBe('250 CAD');
    expect(item.creditSummary).toBe('0.0035 BTC');
    expect(item.feeSummary).toBeUndefined();
    expect(item.primaryMovementAsset).toBe('CAD');
    expect(item.primaryMovementDirection).toBe('out');
    expect(item.inflows[0]).toMatchObject({
      movementFingerprint: 'inflow:btc:1',
      movementRole: 'principal',
    });
    expect(item.outflows[0]).toMatchObject({
      movementFingerprint: 'outflow:cad:1',
      movementRole: 'principal',
    });
    expect(item.annotations).toEqual([]);
  });

  it('aggregates repeated assets into balance summaries', () => {
    const item = toTransactionViewItem(
      createTransaction({
        movements: {
          inflows: [
            {
              assetId: 'asset:btc',
              assetSymbol: 'BTC' as Currency,
              movementFingerprint: 'inflow:btc:1',
              grossAmount: parseDecimal('0.002'),
              netAmount: parseDecimal('0.002'),
            },
            {
              assetId: 'asset:btc',
              assetSymbol: 'BTC' as Currency,
              movementFingerprint: 'inflow:btc:2',
              grossAmount: parseDecimal('0.0015'),
              netAmount: parseDecimal('0.0015'),
            },
          ],
          outflows: [
            {
              assetId: 'asset:cad',
              assetSymbol: 'CAD' as Currency,
              movementFingerprint: 'outflow:cad:1',
              grossAmount: parseDecimal('100'),
              netAmount: parseDecimal('100'),
            },
            {
              assetId: 'asset:cad',
              assetSymbol: 'CAD' as Currency,
              movementFingerprint: 'outflow:cad:2',
              grossAmount: parseDecimal('150'),
              netAmount: parseDecimal('150'),
            },
          ],
        },
      })
    );

    expect(item.debitSummary).toBe('250 CAD');
    expect(item.creditSummary).toBe('0.0035 BTC');
  });

  it('includes only separate fee debits in the fee summary', () => {
    const item = toTransactionViewItem(
      createTransaction({
        fees: [
          {
            assetId: 'asset:cad',
            assetSymbol: 'CAD' as Currency,
            amount: parseDecimal('1.25'),
            scope: 'platform',
            settlement: 'balance',
            movementFingerprint: 'fee:cad:1',
          },
        ],
      })
    );

    expect(item.debitSummary).toBe('250 CAD');
    expect(item.creditSummary).toBe('0.0035 BTC');
    expect(item.feeSummary).toBe('1.25 CAD');
  });

  it('excludes on-chain fees from the separate fee summary', () => {
    const item = toTransactionViewItem(
      createTransaction({
        operation: { category: 'transfer', type: 'withdrawal' },
        movements: {
          inflows: [],
          outflows: [
            {
              assetId: 'asset:btc',
              assetSymbol: 'BTC' as Currency,
              movementFingerprint: 'outflow:btc:1',
              grossAmount: parseDecimal('1'),
              netAmount: parseDecimal('0.999'),
            },
          ],
        },
        fees: [
          {
            assetId: 'asset:btc',
            assetSymbol: 'BTC' as Currency,
            amount: parseDecimal('0.001'),
            scope: 'network',
            settlement: 'on-chain',
            movementFingerprint: 'fee:btc:1',
          },
        ],
      })
    );

    expect(item.debitSummary).toBe('1 BTC');
    expect(item.creditSummary).toBeUndefined();
    expect(item.feeSummary).toBeUndefined();
  });

  it('preserves non-principal movement roles in display items', () => {
    const item = toTransactionViewItem(
      createTransaction({
        movements: {
          inflows: [
            {
              assetId: 'asset:ada',
              assetSymbol: 'ADA' as Currency,
              movementFingerprint: 'movement:1234567890abcdef1234567890abcdef:2',
              movementRole: 'staking_reward',
              grossAmount: parseDecimal('10.5'),
              netAmount: parseDecimal('10.5'),
            },
          ],
          outflows: [],
        },
      })
    );

    expect(item.inflows[0]).toMatchObject({
      movementFingerprint: 'movement:1234567890abcdef1234567890abcdef:2',
      movementRole: 'staking_reward',
    });
  });

  it('carries transaction annotations onto the view item', () => {
    const annotations: TransactionAnnotation[] = [
      {
        annotationFingerprint: 'annotation-1',
        accountId: 1,
        transactionId: 1,
        txFingerprint: 'coinbase:trade:swap-1',
        kind: 'bridge_participant',
        tier: 'heuristic',
        target: { scope: 'transaction' },
        role: 'source',
        detectorId: 'heuristic-bridge-participant',
        derivedFromTxIds: [1, 2],
        provenanceInputs: ['timing', 'counterparty'],
        metadata: {
          counterpartTxFingerprint: 'arb-bridge-counterpart',
          sourceChain: 'ethereum',
          destinationChain: 'arbitrum',
        },
      },
    ];

    const item = toTransactionViewItem(createTransaction(), undefined, annotations);

    expect(item.annotations).toEqual(annotations);
    expect(item.operationGroup).toBe('transfer');
    expect(item.operationLabel).toBe('bridge/send');
  });
});
