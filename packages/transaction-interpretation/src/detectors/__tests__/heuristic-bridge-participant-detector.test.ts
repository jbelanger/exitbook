import type { Transaction } from '@exitbook/core';
import { parseDecimal, type Currency } from '@exitbook/foundation';
import { assertOk } from '@exitbook/foundation/test-utils';
import { describe, expect, it } from 'vitest';

import { HeuristicBridgeParticipantDetector } from '../heuristic-bridge-participant-detector.js';

function makeNativeTransaction(
  overrides: Partial<Transaction> & {
    amount?: string | undefined;
    direction: 'inflow' | 'outflow';
  }
): Transaction {
  const amount = parseDecimal(overrides.amount ?? '1');
  const direction = overrides.direction;
  const platformKey = overrides.platformKey ?? 'ethereum';
  const blockchainName = overrides.blockchain?.name ?? platformKey;

  return {
    id: overrides.id ?? 11,
    accountId: overrides.accountId ?? 7,
    txFingerprint: overrides.txFingerprint ?? `tx-${overrides.id ?? 11}`,
    datetime: overrides.datetime ?? '2025-01-01T00:00:00.000Z',
    timestamp: overrides.timestamp ?? 1_735_689_600_000,
    platformKey,
    platformKind: 'blockchain',
    status: 'success',
    from: overrides.from ?? '0xself',
    to: overrides.to ?? '0xcounterparty',
    movements: {
      inflows:
        direction === 'inflow'
          ? [
              {
                assetId: `blockchain:${blockchainName}:native`,
                assetSymbol: 'ETH' as Currency,
                grossAmount: amount,
                netAmount: amount,
                movementFingerprint: `in-${overrides.id ?? 11}`,
              },
            ]
          : [],
      outflows:
        direction === 'outflow'
          ? [
              {
                assetId: `blockchain:${blockchainName}:native`,
                assetSymbol: 'ETH' as Currency,
                grossAmount: amount,
                netAmount: amount,
                movementFingerprint: `out-${overrides.id ?? 11}`,
              },
            ]
          : [],
    },
    fees: [],
    operation:
      overrides.operation ??
      (direction === 'outflow'
        ? { category: 'transfer', type: 'withdrawal' }
        : { category: 'transfer', type: 'deposit' }),
    blockchain: {
      name: blockchainName,
      transaction_hash: overrides.blockchain?.transaction_hash ?? `hash-${overrides.id ?? 11}`,
      is_confirmed: true,
    },
    diagnostics: overrides.diagnostics,
    excludedFromAccounting: false,
    ...overrides,
  };
}

describe('HeuristicBridgeParticipantDetector', () => {
  it('emits paired heuristic bridge annotations for a unique same-owner native cross-chain pair', async () => {
    const detector = new HeuristicBridgeParticipantDetector();
    const sourceTransaction = makeNativeTransaction({
      id: 101,
      accountId: 21,
      txFingerprint: 'eth-heuristic-source',
      platformKey: 'ethereum',
      direction: 'outflow',
      amount: '1.005',
      timestamp: Date.parse('2024-08-15T18:10:00.000Z'),
      from: '0x15a2000000000000000000000000000000000000',
      to: '0xrouter000000000000000000000000000000000001',
    });
    const targetTransaction = makeNativeTransaction({
      id: 102,
      accountId: 22,
      txFingerprint: 'arb-heuristic-target',
      platformKey: 'arbitrum',
      direction: 'inflow',
      amount: '0.998',
      timestamp: Date.parse('2024-08-15T18:18:00.000Z'),
      from: '0xrouter000000000000000000000000000000000002',
      to: '0x15a2000000000000000000000000000000000000',
    });

    const result = await detector.run({
      profileId: 1,
      accounts: [
        {
          accountId: 21,
          identifier: '0x15a2000000000000000000000000000000000000',
          profileId: 1,
        },
        {
          accountId: 22,
          identifier: '0x15a2000000000000000000000000000000000000',
          profileId: 1,
        },
      ],
      transactions: [sourceTransaction, targetTransaction],
    });

    const annotations = assertOk(result).annotations;
    expect(annotations).toHaveLength(2);
    const sourceAnnotation = annotations.find((annotation) => annotation.transactionId === 101);
    const targetAnnotation = annotations.find((annotation) => annotation.transactionId === 102);

    expect(sourceAnnotation).toMatchObject({
      transactionId: 101,
      role: 'source',
      tier: 'heuristic',
      detectorId: 'heuristic-bridge-participant',
      derivedFromTxIds: [101, 102],
    });
    expect(sourceAnnotation?.metadata).toEqual({
      counterpartTxFingerprint: 'arb-heuristic-target',
      sourceChain: 'ethereum',
      destinationChain: 'arbitrum',
    });

    expect(targetAnnotation).toMatchObject({
      transactionId: 102,
      role: 'target',
      tier: 'heuristic',
      detectorId: 'heuristic-bridge-participant',
      derivedFromTxIds: [101, 102],
    });
    expect(targetAnnotation?.metadata).toEqual({
      counterpartTxFingerprint: 'eth-heuristic-source',
      sourceChain: 'ethereum',
      destinationChain: 'arbitrum',
    });
  });

  it('does not emit heuristic annotations for transactions with explicit bridge diagnostics', async () => {
    const detector = new HeuristicBridgeParticipantDetector();
    const sourceTransaction = makeNativeTransaction({
      id: 201,
      accountId: 31,
      txFingerprint: 'eth-explicit-source',
      platformKey: 'ethereum',
      direction: 'outflow',
      diagnostics: [
        {
          code: 'bridge_transfer',
          message: 'Explicit bridge transfer.',
          severity: 'info',
          metadata: { bridgeFamily: 'wormhole' },
        },
      ],
      from: '0xowner',
      to: '0xrouter1',
    });
    const targetTransaction = makeNativeTransaction({
      id: 202,
      accountId: 32,
      txFingerprint: 'arb-explicit-target',
      platformKey: 'arbitrum',
      direction: 'inflow',
      from: '0xrouter2',
      to: '0xowner',
    });

    const result = await detector.run({
      profileId: 1,
      accounts: [
        { accountId: 31, identifier: '0xowner', profileId: 1 },
        { accountId: 32, identifier: '0xowner', profileId: 1 },
      ],
      transactions: [sourceTransaction, targetTransaction],
    });

    expect(assertOk(result).annotations).toEqual([]);
  });

  it('does not emit when a source has multiple eligible heuristic bridge targets', async () => {
    const detector = new HeuristicBridgeParticipantDetector();
    const sourceTransaction = makeNativeTransaction({
      id: 301,
      accountId: 41,
      txFingerprint: 'eth-ambiguous-source',
      platformKey: 'ethereum',
      direction: 'outflow',
      amount: '1.005',
      timestamp: Date.parse('2024-08-15T18:10:00.000Z'),
      from: '0xowner',
      to: '0xrouter1',
    });
    const targetOne = makeNativeTransaction({
      id: 302,
      accountId: 42,
      txFingerprint: 'arb-ambiguous-target',
      platformKey: 'arbitrum',
      direction: 'inflow',
      amount: '0.998',
      timestamp: Date.parse('2024-08-15T18:18:00.000Z'),
      from: '0xrouter2',
      to: '0xowner',
    });
    const targetTwo = makeNativeTransaction({
      id: 303,
      accountId: 43,
      txFingerprint: 'op-ambiguous-target',
      platformKey: 'optimism',
      direction: 'inflow',
      amount: '0.999',
      timestamp: Date.parse('2024-08-15T18:19:00.000Z'),
      from: '0xrouter3',
      to: '0xowner',
    });

    const result = await detector.run({
      profileId: 1,
      accounts: [
        { accountId: 41, identifier: '0xowner', profileId: 1 },
        { accountId: 42, identifier: '0xowner', profileId: 1 },
        { accountId: 43, identifier: '0xowner', profileId: 1 },
      ],
      transactions: [sourceTransaction, targetOne, targetTwo],
    });

    expect(assertOk(result).annotations).toEqual([]);
  });
});
