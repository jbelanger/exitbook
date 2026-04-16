import type { Transaction } from '@exitbook/core';
import { ok, parseDecimal, type Currency } from '@exitbook/foundation';
import { assertOk } from '@exitbook/foundation/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockBuildPreparedAccountingTransactions } = vi.hoisted(() => ({
  mockBuildPreparedAccountingTransactions: vi.fn(),
}));

vi.mock('../../../accounting-model/prepare-accounting-transactions.js', () => ({
  prepareAccountingTransactions: mockBuildPreparedAccountingTransactions,
}));

import { createPriceAtTxTime, createTransactionFromMovements } from '../../../__tests__/test-utils.js';
import { stabilizeExcludedRebuildTransactions } from '../price-completeness.js';

function createTransaction(id: number, hasPrice: boolean): Transaction {
  return createTransactionFromMovements(id, '2025-06-15T00:00:00.000Z', {
    inflows: [
      {
        assetId: 'blockchain:bitcoin:native',
        assetSymbol: 'BTC' as Currency,
        grossAmount: parseDecimal('1'),
        ...(hasPrice ? { priceAtTxTime: createPriceAtTxTime('50000') } : {}),
      },
    ],
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('stabilizeExcludedRebuildTransactions', () => {
  it('re-runs validation until the retained transaction ids reach a fixed point', () => {
    const priced = createTransaction(1, true);
    const dependency = createTransaction(2, false);

    mockBuildPreparedAccountingTransactions
      .mockReturnValueOnce(
        ok({
          inputTransactions: [priced, dependency],
          transactions: [
            {
              tx: priced,
              rebuildDependencyTransactionIds: [],
              movements: {
                inflows: [
                  {
                    ...priced.movements.inflows![0]!,
                    grossAmount: parseDecimal('1'),
                  },
                ],
                outflows: [],
              },
              fees: [],
            },
          ],
          internalTransferCarryoverDrafts: [],
        })
      )
      .mockReturnValueOnce(
        ok({
          inputTransactions: [priced],
          transactions: [
            {
              tx: priced,
              rebuildDependencyTransactionIds: [],
              movements: {
                inflows: [
                  {
                    ...priced.movements.inflows![0]!,
                    grossAmount: parseDecimal('1'),
                  },
                ],
                outflows: [],
              },
              fees: [],
            },
          ],
          internalTransferCarryoverDrafts: [],
        })
      );

    const result = assertOk(stabilizeExcludedRebuildTransactions([priced, dependency], 'USD'));

    expect(result.map((transaction) => transaction.id)).toEqual([1]);
    expect(mockBuildPreparedAccountingTransactions).toHaveBeenCalledTimes(2);
  });
});
