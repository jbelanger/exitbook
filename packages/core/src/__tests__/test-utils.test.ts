import { describe, expect, it } from 'vitest';

import {
  buildAssetMovementCanonicalMaterial,
  buildFeeMovementCanonicalMaterial,
  computeAccountFingerprint,
  computeMovementFingerprint,
  computeTxFingerprint,
  parseDecimal,
} from '../index.js';

import {
  assertOk,
  seedAssetMovementFingerprint,
  seedFeeMovementFingerprint,
  seedMovementFingerprint,
  seedTxFingerprint,
} from './test-utils.js';

describe('@exitbook/core/test-utils', () => {
  it('matches production tx fingerprints for explicit exchange source types', async () => {
    const accountFingerprint = assertOk(
      computeAccountFingerprint({
        accountType: 'exchange-api',
        sourceName: 'kraken',
        identifier: 'identifier-12',
      })
    );

    const expected = assertOk(
      computeTxFingerprint({
        accountFingerprint,
        source: 'kraken',
        sourceType: 'exchange',
        componentEventIds: ['fill-1'],
      })
    );

    expect(seedTxFingerprint('kraken', 'exchange', 12, 'fill-1')).toBe(expected);
  });

  it('matches production tx fingerprints for inferred blockchain sources', async () => {
    const accountFingerprint = assertOk(
      computeAccountFingerprint({
        accountType: 'blockchain',
        sourceName: 'ethereum',
        identifier: 'identifier-7',
      })
    );

    const expected = assertOk(
      computeTxFingerprint({
        accountFingerprint,
        source: 'ethereum',
        sourceType: 'blockchain',
        blockchainTransactionHash: '0xabc',
      })
    );

    expect(seedTxFingerprint('ethereum', 7, '0xabc')).toBe(expected);
  });

  it('matches production movement fingerprints for canonical material', async () => {
    const canonicalMaterial = buildAssetMovementCanonicalMaterial({
      movementType: 'inflow',
      assetId: 'asset:btc',
      grossAmount: parseDecimal('1.5'),
      netAmount: parseDecimal('1.49'),
    });

    const expected = assertOk(
      computeMovementFingerprint({
        txFingerprint: 'tx-1',
        canonicalMaterial,
        duplicateOccurrence: 2,
      })
    );

    expect(seedMovementFingerprint('tx-1', canonicalMaterial, 2)).toBe(expected);
  });

  it('matches production asset and fee fingerprint helpers', async () => {
    const assetMovement = {
      assetId: 'asset:eth',
      grossAmount: parseDecimal('3'),
      netAmount: parseDecimal('2.99'),
    };
    const feeMovement = {
      assetId: 'asset:eth',
      amount: parseDecimal('0.01'),
      scope: 'network' as const,
      settlement: 'on-chain' as const,
    };

    const expectedAssetFingerprint = assertOk(
      computeMovementFingerprint({
        txFingerprint: 'tx-2',
        canonicalMaterial: buildAssetMovementCanonicalMaterial({
          movementType: 'outflow',
          assetId: assetMovement.assetId,
          grossAmount: assetMovement.grossAmount,
          netAmount: assetMovement.netAmount,
        }),
        duplicateOccurrence: 3,
      })
    );
    const expectedFeeFingerprint = assertOk(
      computeMovementFingerprint({
        txFingerprint: 'tx-2',
        canonicalMaterial: buildFeeMovementCanonicalMaterial({
          assetId: feeMovement.assetId,
          amount: feeMovement.amount,
          scope: feeMovement.scope,
          settlement: feeMovement.settlement,
        }),
        duplicateOccurrence: 1,
      })
    );

    expect(seedAssetMovementFingerprint('tx-2', 'outflow', assetMovement, 3)).toBe(expectedAssetFingerprint);
    expect(seedFeeMovementFingerprint('tx-2', feeMovement)).toBe(expectedFeeFingerprint);
  });
});
