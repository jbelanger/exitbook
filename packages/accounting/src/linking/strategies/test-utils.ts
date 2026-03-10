import { type Currency, parseDecimal } from '@exitbook/core';

import { createLinkableMovement } from '../shared/test-utils.js';

export function createImpossibleMultiSourceAdaHashPartialScenario() {
  const hash = '0c62fbdfe97c5e94346f0976114b769b45080dc5d9e0c03ca33ad112dc8f25cf';

  const sources = [
    createLinkableMovement({
      id: 1,
      transactionId: 8930,
      accountId: 61,
      sourceName: 'cardano',
      sourceType: 'blockchain',
      assetId: 'blockchain:cardano:native',
      assetSymbol: 'ADA' as Currency,
      amount: parseDecimal('1021.211168'),
      grossAmount: parseDecimal('1021.402541'),
      direction: 'out',
      timestamp: new Date('2024-07-25T20:32:02.000Z'),
      blockchainTxHash: hash,
      toAddress:
        'addr1q95qk0u05drsy3e3qfjzspgc97a3f8ktv23se96sqfw4204c0rqf3wsyvp6zyxwgg0f7p0d8h0d8z6kpf6asuetxeussscaha9',
      movementFingerprint: 'movement:tx:v2:cardano:61:hash:outflow:0',
    }),
    createLinkableMovement({
      id: 2,
      transactionId: 8935,
      accountId: 63,
      sourceName: 'cardano',
      sourceType: 'blockchain',
      assetId: 'blockchain:cardano:native',
      assetSymbol: 'ADA' as Currency,
      amount: parseDecimal('974.843208'),
      grossAmount: parseDecimal('975.034581'),
      direction: 'out',
      timestamp: new Date('2024-07-25T20:32:02.000Z'),
      blockchainTxHash: hash,
      toAddress:
        'addr1q95qk0u05drsy3e3qfjzspgc97a3f8ktv23se96sqfw4204c0rqf3wsyvp6zyxwgg0f7p0d8h0d8z6kpf6asuetxeussscaha9',
      movementFingerprint: 'movement:tx:v2:cardano:63:hash:outflow:0',
    }),
    createLinkableMovement({
      id: 3,
      transactionId: 8937,
      accountId: 65,
      sourceName: 'cardano',
      sourceType: 'blockchain',
      assetId: 'blockchain:cardano:native',
      assetSymbol: 'ADA' as Currency,
      amount: parseDecimal('672.756869'),
      grossAmount: parseDecimal('672.948242'),
      direction: 'out',
      timestamp: new Date('2024-07-25T20:32:02.000Z'),
      blockchainTxHash: hash,
      toAddress:
        'addr1q95qk0u05drsy3e3qfjzspgc97a3f8ktv23se96sqfw4204c0rqf3wsyvp6zyxwgg0f7p0d8h0d8z6kpf6asuetxeussscaha9',
      movementFingerprint: 'movement:tx:v2:cardano:65:hash:outflow:0',
    }),
  ];

  const targets = [
    createLinkableMovement({
      id: 10,
      transactionId: 9021,
      accountId: 90,
      sourceName: 'kucoin',
      sourceType: 'exchange',
      assetId: 'exchange:kucoin:ada',
      assetSymbol: 'ADA' as Currency,
      amount: parseDecimal('2679.718442'),
      direction: 'in',
      timestamp: new Date('2024-07-25T20:35:47.000Z'),
      blockchainTxHash: hash,
      movementFingerprint: 'movement:tx:v2:kucoin:90:hash:inflow:0',
    }),
  ];

  return { sources, targets };
}
