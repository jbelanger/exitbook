import { type Currency, parseDecimal } from '@exitbook/foundation';
import { assertOk } from '@exitbook/foundation/test-utils';
import type { Logger } from '@exitbook/logger';
import { describe, expect, it } from 'vitest';

import { createFee, createMovement, createTransactionFromMovements } from '../../../../__tests__/test-utils.js';
import { buildCostBasisScopedTransactions } from '../../matching/build-cost-basis-scoped-transactions.js';
import {
  applyAccountingExclusionPolicy,
  createAccountingExclusionPolicy,
  hasAccountingExclusions,
  isExcludedAsset,
} from '../accounting-exclusion-policy.js';

const noopLogger = {
  trace: () => {
    /* noop */
  },
  debug: () => {
    /* noop */
  },
  info: () => {
    /* noop */
  },
  warn: () => {
    /* noop */
  },
  error: () => {
    /* noop */
  },
  child: () => noopLogger,
} as unknown as Logger;

describe('accounting-exclusion-policy', () => {
  it('reports whether a policy has any exclusions', () => {
    expect(hasAccountingExclusions(undefined)).toBe(false);
    expect(hasAccountingExclusions(createAccountingExclusionPolicy())).toBe(false);
    expect(hasAccountingExclusions(createAccountingExclusionPolicy(['test:scam']))).toBe(true);
  });

  it('prunes excluded movements from a mixed transaction and keeps included activity', () => {
    const transaction = createTransactionFromMovements(1, '2025-01-10T00:00:00.000Z', {
      inflows: [createMovement('ETH', '1', '3000'), createMovement('SCAM', '1000')],
    });
    const scopedBuildResult = assertOk(buildCostBasisScopedTransactions([transaction], noopLogger));
    scopedBuildResult.transactions[0]!.rebuildDependencyTransactionIds.push(99);

    const result = applyAccountingExclusionPolicy(scopedBuildResult, createAccountingExclusionPolicy(['test:scam']));

    expect(result.fullyExcludedTransactionIds.size).toBe(0);
    expect(result.partiallyExcludedTransactionIds.has(1)).toBe(true);
    expect(result.scopedBuildResult.transactions).toHaveLength(1);
    expect(result.scopedBuildResult.transactions[0]?.rebuildDependencyTransactionIds).toEqual([99]);
    expect(result.scopedBuildResult.transactions[0]?.movements.inflows.map((movement) => movement.assetId)).toEqual([
      'test:eth',
    ]);
  });

  it('drops transactions that become empty after exclusion', () => {
    const transaction = createTransactionFromMovements(1, '2025-01-10T00:00:00.000Z', {
      inflows: [createMovement('SCAM', '1000')],
    });
    const scopedBuildResult = assertOk(buildCostBasisScopedTransactions([transaction], noopLogger));

    const result = applyAccountingExclusionPolicy(scopedBuildResult, createAccountingExclusionPolicy(['test:scam']));

    expect(result.fullyExcludedTransactionIds.has(1)).toBe(true);
    expect(result.partiallyExcludedTransactionIds.size).toBe(0);
    expect(result.scopedBuildResult.transactions).toHaveLength(0);
  });

  it('prunes excluded fees and fee-only carryovers', () => {
    const transaction = createTransactionFromMovements(
      1,
      '2025-01-10T00:00:00.000Z',
      {
        inflows: [createMovement('ETH', '1', '3000')],
      },
      [createFee('SCAM', '5')]
    );
    const scopedBuildResult = assertOk(buildCostBasisScopedTransactions([transaction], noopLogger));
    scopedBuildResult.feeOnlyInternalCarryovers.push({
      assetId: 'test:scam',
      assetSymbol: 'SCAM' as Currency,
      fee: {
        assetId: 'test:scam',
        assetSymbol: 'SCAM' as Currency,
        amount: parseDecimal('1'),
        movementFingerprint: 'movement:test:scam:fee:carryover',
        scope: 'network',
        settlement: 'on-chain',
        originalTransactionId: 1,
      },
      retainedQuantity: parseDecimal('1'),
      sourceTransactionId: 1,
      sourceMovementFingerprint: 'movement:source:outflow:0',
      targets: [
        {
          targetMovementFingerprint: 'movement:target:inflow:0',
          quantity: parseDecimal('1'),
          targetTransactionId: 2,
        },
      ],
    });

    const result = applyAccountingExclusionPolicy(scopedBuildResult, createAccountingExclusionPolicy(['test:scam']));

    expect(result.scopedBuildResult.transactions).toHaveLength(1);
    expect(result.scopedBuildResult.transactions[0]?.fees).toEqual([]);
    expect(result.scopedBuildResult.feeOnlyInternalCarryovers).toEqual([]);
  });

  it('recognizes excluded assets through the shared predicate', () => {
    const policy = createAccountingExclusionPolicy(['test:scam']);

    expect(isExcludedAsset(policy, 'test:scam')).toBe(true);
    expect(isExcludedAsset(policy, 'test:eth')).toBe(false);
  });
});
