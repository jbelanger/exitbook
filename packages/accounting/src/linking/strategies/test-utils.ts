import type { Transaction } from '@exitbook/core';
import { type Currency, parseDecimal } from '@exitbook/foundation';

import { materializeTestTransaction } from '../../__tests__/test-utils.js';
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

export function createImpossibleMultiSourceAdaHashPartialTransactions(): Transaction[] {
  return [
    createTransferTransaction({
      accountId: 61,
      amount: '1021.211168',
      datetime: '2024-07-25T20:32:02.000Z',
      identityReference: 'cardano-8930',
      fees: '0.191373',
      grossAmount: '1021.402541',
      id: 8930,
      source: 'cardano',
      sourceType: 'blockchain',
    }),
    createTransferTransaction({
      accountId: 63,
      amount: '974.843208',
      datetime: '2024-07-25T20:32:02.000Z',
      identityReference: 'cardano-8935',
      fees: '0.191373',
      grossAmount: '975.034581',
      id: 8935,
      source: 'cardano',
      sourceType: 'blockchain',
    }),
    createTransferTransaction({
      accountId: 65,
      amount: '672.756869',
      datetime: '2024-07-25T20:32:02.000Z',
      identityReference: 'cardano-8937',
      fees: '0.191373',
      grossAmount: '672.948242',
      id: 8937,
      source: 'cardano',
      sourceType: 'blockchain',
    }),
    createTransferTransaction({
      accountId: 90,
      amount: '2679.718442',
      datetime: '2024-07-25T20:35:47.000Z',
      identityReference: 'kucoin-9021',
      id: 9021,
      operationType: 'deposit',
      source: 'kucoin',
      sourceType: 'exchange',
    }),
  ];
}

function createTransferTransaction(params: {
  accountId: number;
  amount: string;
  datetime: string;
  fees?: string | undefined;
  grossAmount?: string | undefined;
  id: number;
  identityReference: string;
  operationType?: 'withdrawal' | 'deposit' | undefined;
  source: string;
  sourceType: 'blockchain' | 'exchange';
}): Transaction {
  const grossAmount = parseDecimal(params.grossAmount ?? params.amount);
  const netAmount = parseDecimal(params.amount);
  const feeAmount = params.fees ? parseDecimal(params.fees) : undefined;

  return materializeTestTransaction({
    id: params.id,
    accountId: params.accountId,
    identityReference: params.identityReference,
    source: params.source,
    sourceType: params.sourceType,
    datetime: params.datetime,
    timestamp: Date.parse(params.datetime),
    status: 'success',
    movements: {
      inflows:
        params.operationType === 'deposit'
          ? [
              {
                assetId: params.sourceType === 'exchange' ? 'exchange:kucoin:ada' : 'blockchain:cardano:native',
                assetSymbol: 'ADA' as Currency,
                grossAmount,
                netAmount,
              },
            ]
          : [],
      outflows:
        params.operationType === 'deposit'
          ? []
          : [
              {
                assetId: 'blockchain:cardano:native',
                assetSymbol: 'ADA' as Currency,
                grossAmount,
                netAmount,
              },
            ],
    },
    fees:
      feeAmount !== undefined
        ? [
            {
              assetId: 'blockchain:cardano:native',
              assetSymbol: 'ADA' as Currency,
              amount: feeAmount,
              scope: 'network',
              settlement: 'on-chain',
            },
          ]
        : [],
    operation: {
      category: 'transfer',
      type: params.operationType ?? 'withdrawal',
    },
  });
}
