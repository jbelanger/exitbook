import { formatMovementFingerprintRef } from '@exitbook/core';
import { parseDecimal, type Currency } from '@exitbook/foundation';
import { assertErr, assertOk } from '@exitbook/foundation/test-utils';
import { describe, expect, it } from 'vitest';

import { ExitCodes } from '../../../../cli/exit-codes.js';
import { createPersistedTransaction } from '../../../shared/__tests__/transaction-test-utils.js';
import {
  formatResolvedMovementSummary,
  getTransactionMovementSelectorErrorExitCode,
  resolveTransactionMovementSelector,
  TransactionMovementSelectorResolutionError,
} from '../transaction-movement-selector.js';

function createTransaction(movements: Parameters<typeof createPersistedTransaction>[0]['movements']) {
  return createPersistedTransaction({
    id: 1,
    accountId: 1,
    txFingerprint: 'tx-fingerprint-1',
    platformKey: 'kraken',
    platformKind: 'exchange',
    datetime: '2026-04-10T12:00:00.000Z',
    timestamp: Date.parse('2026-04-10T12:00:00.000Z'),
    status: 'success',
    operation: { category: 'transfer', type: 'deposit' },
    movements,
    fees: [],
  });
}

describe('transaction movement selector', () => {
  it('resolves a movement by rendered movement ref within one transaction', () => {
    const transaction = createTransaction({
      inflows: [
        {
          assetId: 'exchange:kraken:btc',
          assetSymbol: 'BTC' as Currency,
          grossAmount: parseDecimal('1.5'),
          netAmount: parseDecimal('1.5'),
        },
      ],
      outflows: [],
    });

    const selector = formatMovementFingerprintRef(transaction.movements.inflows![0]!.movementFingerprint);
    const resolved = assertOk(resolveTransactionMovementSelector(transaction, selector));

    expect(resolved.direction).toBe('inflow');
    expect(resolved.movement.assetSymbol).toBe('BTC');
    expect(resolved.movementRef).toBe(selector);
    expect(formatResolvedMovementSummary(resolved)).toBe('+ 1.5 BTC');
  });

  it('returns not-found for missing refs', () => {
    const transaction = createTransaction({
      inflows: [],
      outflows: [],
    });

    const error = assertErr(resolveTransactionMovementSelector(transaction, 'deadbeef00'));
    expect(error).toBeInstanceOf(TransactionMovementSelectorResolutionError);
    expect(getTransactionMovementSelectorErrorExitCode(error)).toBe(ExitCodes.NOT_FOUND);
  });

  it('formats non-principal role in the movement summary', () => {
    const transaction = createTransaction({
      inflows: [
        {
          movementRole: 'staking_reward',
          assetId: 'blockchain:cardano:native',
          assetSymbol: 'ADA' as Currency,
          grossAmount: parseDecimal('10.5'),
          netAmount: parseDecimal('10.5'),
        },
      ],
      outflows: [],
    });

    const selector = formatMovementFingerprintRef(transaction.movements.inflows![0]!.movementFingerprint);
    const resolved = assertOk(resolveTransactionMovementSelector(transaction, selector));

    expect(formatResolvedMovementSummary(resolved)).toBe('+ 10.5 ADA [staking_reward]');
  });
});
