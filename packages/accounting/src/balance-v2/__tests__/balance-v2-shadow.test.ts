import type { AssetMovement, FeeMovement } from '@exitbook/core';
import { parseCurrency, parseDecimal } from '@exitbook/foundation';
import { assertErr, assertOk } from '@exitbook/foundation/test-utils';
import { describe, expect, it } from 'vitest';

import type { BalanceV2PostingInput } from '../balance-v2-runner.js';
import { buildLegacyBalanceV2FromTransactions, reconcileBalanceV2Shadow } from '../balance-v2-shadow.js';
import type { BalanceV2LegacyTransactionInput } from '../balance-v2-shadow.js';

const ADA = assertOk(parseCurrency('ADA'));

describe('balance-v2 shadow reconciliation', () => {
  it('builds legacy account balances from transaction balance impact', () => {
    const result = assertOk(
      buildLegacyBalanceV2FromTransactions([
        legacyTransaction({
          accountId: 1,
          txFingerprint: 'tx:1',
          inflows: [movement('inflow:1', '10')],
          outflows: [movement('outflow:1', '3')],
          fees: [fee('fee:1', '0.2', 'balance')],
        }),
        legacyTransaction({
          accountId: 2,
          txFingerprint: 'tx:2',
          inflows: [movement('inflow:2', '5')],
        }),
      ])
    );

    expect(
      result.balances.map((balance) => ({
        accountId: balance.accountId,
        assetId: balance.assetId,
        quantity: balance.quantity.toFixed(),
        transactionFingerprints: balance.transactionFingerprints,
      }))
    ).toEqual([
      {
        accountId: 1,
        assetId: 'blockchain:cardano:native',
        quantity: '6.8',
        transactionFingerprints: ['tx:1'],
      },
      {
        accountId: 2,
        assetId: 'blockchain:cardano:native',
        quantity: '5',
        transactionFingerprints: ['tx:2'],
      },
    ]);
  });

  it('reconciles matching legacy transactions and ledger postings', () => {
    const report = assertOk(
      reconcileBalanceV2Shadow({
        legacyTransactions: [
          legacyTransaction({
            txFingerprint: 'tx:1',
            inflows: [movement('inflow:1', '10')],
            outflows: [movement('outflow:1', '3')],
            fees: [fee('fee:1', '0.2', 'balance')],
          }),
        ],
        ledgerPostings: [
          ledgerPosting({ quantity: '10', postingFingerprint: 'posting:in' }),
          ledgerPosting({ quantity: '-3', postingFingerprint: 'posting:out' }),
          ledgerPosting({ quantity: '-0.2', postingFingerprint: 'posting:fee' }),
        ],
      })
    );

    expect(report.diffs).toEqual([]);
    expect(report.ledgerBalances[0]?.quantity.toFixed()).toBe('6.8');
    expect(report.legacyBalances[0]?.quantity.toFixed()).toBe('6.8');
  });

  it('reports account and asset diffs with ledger provenance', () => {
    const report = assertOk(
      reconcileBalanceV2Shadow({
        legacyTransactions: [
          legacyTransaction({
            txFingerprint: 'tx:1',
            inflows: [movement('inflow:1', '10')],
          }),
        ],
        ledgerPostings: [
          ledgerPosting({
            quantity: '9',
            journalFingerprint: 'journal:1',
            postingFingerprint: 'posting:1',
            sourceActivityFingerprint: 'activity:1',
          }),
        ],
      })
    );

    expect(report.diffs).toHaveLength(1);
    expect(report.diffs[0]).toMatchObject({
      accountId: 1,
      assetId: 'blockchain:cardano:native',
      assetSymbol: 'ADA',
      ledgerJournalFingerprints: ['journal:1'],
      ledgerPostingFingerprints: ['posting:1'],
      ledgerSourceActivityFingerprints: ['activity:1'],
      legacyTransactionFingerprints: ['tx:1'],
    });
    expect(report.diffs[0]?.legacyQuantity.toFixed()).toBe('10');
    expect(report.diffs[0]?.ledgerQuantity.toFixed()).toBe('9');
    expect(report.diffs[0]?.delta.toFixed()).toBe('-1');
  });

  it('rejects invalid legacy transaction account ids', () => {
    const result = buildLegacyBalanceV2FromTransactions([
      legacyTransaction({
        accountId: 0,
        inflows: [movement('inflow:1', '1')],
      }),
    ]);

    expect(assertErr(result).message).toContain('account id must be positive');
  });
});

function legacyTransaction(
  overrides: {
    accountId?: number | undefined;
    fees?: FeeMovement[] | undefined;
    inflows?: AssetMovement[] | undefined;
    outflows?: AssetMovement[] | undefined;
    txFingerprint?: string | undefined;
  } = {}
): BalanceV2LegacyTransactionInput {
  return {
    accountId: overrides.accountId ?? 1,
    txFingerprint: overrides.txFingerprint ?? 'tx:default',
    movements: {
      inflows: overrides.inflows ?? [],
      outflows: overrides.outflows ?? [],
    },
    fees: overrides.fees ?? [],
  };
}

function movement(movementFingerprint: string, amount: string): AssetMovement {
  return {
    movementFingerprint,
    assetId: 'blockchain:cardano:native',
    assetSymbol: ADA,
    grossAmount: parseDecimal(amount),
    netAmount: parseDecimal(amount),
  };
}

function fee(movementFingerprint: string, amount: string, settlement: FeeMovement['settlement']): FeeMovement {
  return {
    movementFingerprint,
    assetId: 'blockchain:cardano:native',
    assetSymbol: ADA,
    amount: parseDecimal(amount),
    scope: 'network',
    settlement,
  };
}

function ledgerPosting(
  overrides: Omit<Partial<BalanceV2PostingInput>, 'quantity'> & { quantity?: string | undefined } = {}
): BalanceV2PostingInput {
  const { quantity, ...rest } = overrides;

  return {
    accountId: 1,
    assetId: 'blockchain:cardano:native',
    assetSymbol: 'ADA',
    quantity: parseDecimal(quantity ?? '1'),
    journalFingerprint: 'journal:default',
    postingFingerprint: 'posting:default',
    sourceActivityFingerprint: 'activity:default',
    ...rest,
  };
}
