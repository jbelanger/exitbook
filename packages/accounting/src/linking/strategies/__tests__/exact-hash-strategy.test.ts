import { type Currency, parseDecimal } from '@exitbook/foundation';
import { assertOk } from '@exitbook/foundation/test-utils';
import { describe, expect, it } from 'vitest';

import { buildMatchingConfig } from '../../matching/matching-config.js';
import { createLinkableMovement } from '../../shared/test-utils.js';
import { ExactHashStrategy } from '../exact-hash-strategy.js';

describe('ExactHashStrategy', () => {
  it('does not auto-confirm mismatched assets without explicit equivalence', () => {
    const strategy = new ExactHashStrategy();
    const sources = [
      createLinkableMovement({
        id: 1,
        transactionId: 9005,
        sourceName: 'kucoin',
        sourceType: 'exchange',
        assetId: 'exchange:kucoin:rndr',
        assetSymbol: 'RNDR' as Currency,
        amount: parseDecimal('19.5536'),
        direction: 'out',
        timestamp: new Date('2024-05-20T20:14:07.000Z'),
        toAddress: '0x15a2aa147781b08a0105d678386ea63e6ca06281',
        blockchainTxHash: '0x170983ad6190f057007993c13ca9813d126198aea821b537227649f19e466d7b',
      }),
    ];
    const targets = [
      createLinkableMovement({
        id: 2,
        transactionId: 8813,
        sourceName: 'ethereum',
        sourceType: 'blockchain',
        assetId: 'blockchain:ethereum:0x6de037ef9ad2725eb40118bb1702ebb27e4aeb24',
        assetSymbol: 'RENDER' as Currency,
        amount: parseDecimal('19.5536'),
        direction: 'in',
        timestamp: new Date('2024-05-20T20:15:11.000Z'),
        toAddress: '0x15a2aa147781b08a0105d678386ea63e6ca06281',
        blockchainTxHash: '0x170983ad6190f057007993c13ca9813d126198aea821b537227649f19e466d7b',
      }),
    ];

    const result = assertOk(strategy.execute(sources, targets, buildMatchingConfig()));

    expect(result.links).toHaveLength(0);
  });
});
