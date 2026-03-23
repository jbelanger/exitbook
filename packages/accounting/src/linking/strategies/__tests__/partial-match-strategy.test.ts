import { type Currency, parseDecimal } from '@exitbook/foundation';
import { assertOk } from '@exitbook/foundation/test-utils';
import { describe, expect, it } from 'vitest';

import { buildMatchingConfig } from '../../matching/matching-config.js';
import { createLinkableMovement } from '../../shared/test-utils.js';
import { PartialMatchStrategy } from '../partial-match-strategy.js';

describe('PartialMatchStrategy', () => {
  it('keeps hash partial suggestions when only one source carries the fee and capacity reconciles', () => {
    const strategy = new PartialMatchStrategy();
    const hash = '0xvalid';

    const sources = [
      createLinkableMovement({
        id: 1,
        transactionId: 100,
        accountId: 11,
        sourceName: 'bitcoin',
        sourceType: 'blockchain',
        assetId: 'blockchain:bitcoin:native',
        assetSymbol: 'BTC' as Currency,
        amount: parseDecimal('1.0'),
        grossAmount: parseDecimal('1.1'),
        direction: 'out',
        timestamp: new Date('2024-01-01T12:00:00.000Z'),
        blockchainTxHash: hash,
        toAddress: 'bc1target',
        movementFingerprint: 'movement:tx:v2:bitcoin:11:hash:outflow:0',
      }),
      createLinkableMovement({
        id: 2,
        transactionId: 101,
        accountId: 12,
        sourceName: 'bitcoin',
        sourceType: 'blockchain',
        assetId: 'blockchain:bitcoin:native',
        assetSymbol: 'BTC' as Currency,
        amount: parseDecimal('1.0'),
        grossAmount: parseDecimal('1.0'),
        direction: 'out',
        timestamp: new Date('2024-01-01T12:00:00.000Z'),
        blockchainTxHash: hash,
        toAddress: 'bc1target',
        movementFingerprint: 'movement:tx:v2:bitcoin:12:hash:outflow:0',
      }),
    ];
    const targets = [
      createLinkableMovement({
        id: 10,
        transactionId: 200,
        accountId: 20,
        sourceName: 'kraken',
        sourceType: 'exchange',
        assetId: 'exchange:kraken:btc',
        assetSymbol: 'BTC' as Currency,
        amount: parseDecimal('2.0'),
        direction: 'in',
        timestamp: new Date('2024-01-01T12:10:00.000Z'),
        blockchainTxHash: hash,
        movementFingerprint: 'movement:tx:v2:kraken:20:hash:inflow:0',
      }),
    ];

    const result = assertOk(strategy.execute(sources, targets, buildMatchingConfig()));

    expect(result.links).toHaveLength(2);
    expect(result.links.every((link) => link.status === 'suggested')).toBe(true);
  });
});
