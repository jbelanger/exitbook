import type { Transaction } from '@exitbook/core';
import { parseDecimal, type Currency } from '@exitbook/foundation';
import { assertOk } from '@exitbook/foundation/test-utils';
import { createSeedProtocolCatalog } from '@exitbook/protocol-catalog';
import { describe, expect, it } from 'vitest';

import { BridgeParticipantDetector } from '../bridge-participant-detector.js';

function makeTransaction(
  overrides: Partial<Transaction> & {
    diagnostics?: Transaction['diagnostics'];
    inflowCount?: number | undefined;
    outflowCount?: number | undefined;
  } = {}
): Transaction {
  const inflowCount = overrides.inflowCount ?? 0;
  const outflowCount = overrides.outflowCount ?? 1;

  return {
    id: overrides.id ?? 11,
    accountId: overrides.accountId ?? 7,
    txFingerprint: overrides.txFingerprint ?? 'tx-bridge',
    datetime: '2025-01-01T00:00:00.000Z',
    timestamp: 1_735_689_600_000,
    platformKey: overrides.platformKey ?? 'ethereum',
    platformKind: overrides.platformKind ?? 'blockchain',
    status: 'success',
    from: 'source-address',
    to: 'destination-address',
    movements: {
      inflows: Array.from({ length: inflowCount }, (_, index) => ({
        assetId: 'blockchain:ethereum:0xa0b8',
        assetSymbol: 'USDC' as Currency,
        grossAmount: parseDecimal('100'),
        netAmount: parseDecimal('100'),
        movementFingerprint: `in-${index}`,
      })),
      outflows: Array.from({ length: outflowCount }, (_, index) => ({
        assetId: 'blockchain:ethereum:0xa0b8',
        assetSymbol: 'USDC' as Currency,
        grossAmount: parseDecimal('100'),
        netAmount: parseDecimal('100'),
        movementFingerprint: `out-${index}`,
      })),
    },
    fees: [],
    operation: overrides.operation ?? { category: 'transfer', type: 'withdrawal' },
    blockchain:
      overrides.platformKind === 'exchange'
        ? undefined
        : {
            name: overrides.platformKey ?? 'ethereum',
            transaction_hash: '0xhash',
            is_confirmed: true,
          },
    diagnostics: overrides.diagnostics,
    excludedFromAccounting: false,
    ...overrides,
  };
}

describe('BridgeParticipantDetector', () => {
  it('emits an asserted source annotation for an explicit EVM bridge withdrawal', async () => {
    const detector = new BridgeParticipantDetector(createSeedProtocolCatalog());
    const transaction = makeTransaction({
      diagnostics: [
        {
          code: 'bridge_transfer',
          message: 'Bridge withdrawal via Wormhole transferTokensWithPayload.',
          severity: 'info',
          metadata: {
            bridgeFamily: 'wormhole',
            detectionSource: 'function_name',
            functionName: 'transferTokensWithPayload',
          },
        },
      ],
      inflowCount: 0,
      outflowCount: 1,
    });

    const result = await detector.run({
      accountId: transaction.accountId,
      transactionId: transaction.id,
      txFingerprint: transaction.txFingerprint,
      transaction,
    });

    const annotation = assertOk(result).annotations[0];
    expect(annotation).toMatchObject({
      accountId: transaction.accountId,
      transactionId: transaction.id,
      txFingerprint: transaction.txFingerprint,
      kind: 'bridge_participant',
      tier: 'asserted',
      role: 'source',
      protocolRef: { id: 'wormhole' },
      detectorId: 'bridge-participant',
      derivedFromTxIds: [transaction.id],
      provenanceInputs: ['processor', 'diagnostic'],
    });
  });

  it('emits an asserted target annotation with chain hints for an IBC bridge deposit', async () => {
    const detector = new BridgeParticipantDetector(createSeedProtocolCatalog());
    const transaction = makeTransaction({
      platformKey: 'injective',
      diagnostics: [
        {
          code: 'bridge_transfer',
          message: 'Bridge deposit via IBC.',
          severity: 'info',
          metadata: {
            bridgeType: 'ibc',
            sourceChain: 'ibc',
            destinationChain: 'injective',
          },
        },
      ],
      inflowCount: 1,
      outflowCount: 0,
      operation: { category: 'transfer', type: 'deposit' },
    });

    const result = await detector.run({
      accountId: transaction.accountId,
      transactionId: transaction.id,
      txFingerprint: transaction.txFingerprint,
      transaction,
    });

    const annotation = assertOk(result).annotations[0];
    expect(annotation).toMatchObject({
      role: 'target',
      protocolRef: { id: 'ibc' },
      metadata: {
        sourceChain: 'ibc',
        destinationChain: 'injective',
      },
    });
  });

  it('resolves catalog aliases instead of relying on a detector-local hint map', async () => {
    const detector = new BridgeParticipantDetector(createSeedProtocolCatalog());
    const transaction = makeTransaction({
      platformKey: 'ethereum',
      diagnostics: [
        {
          code: 'bridge_transfer',
          message: 'Bridge withdrawal via Injective sendToInjective.',
          severity: 'info',
          metadata: {
            bridgeFamily: 'injective_peggy',
            detectionSource: 'function_name',
            functionName: 'sendToInjective',
          },
        },
      ],
      inflowCount: 0,
      outflowCount: 1,
    });

    const result = await detector.run({
      accountId: transaction.accountId,
      transactionId: transaction.id,
      txFingerprint: transaction.txFingerprint,
      transaction,
    });

    const annotation = assertOk(result).annotations[0];
    expect(annotation?.protocolRef).toEqual({ id: 'peggy' });
  });

  it('does not emit for bridge diagnostics without a resolvable protocol hint', async () => {
    const detector = new BridgeParticipantDetector(createSeedProtocolCatalog());
    const transaction = makeTransaction({
      platformKey: 'solana',
      diagnostics: [
        {
          code: 'bridge_transfer',
          message: 'Provider log messages indicate a bridge or migration receipt.',
          severity: 'info',
          metadata: {
            detectionSource: 'log_messages',
          },
        },
      ],
      inflowCount: 1,
      outflowCount: 0,
      operation: { category: 'transfer', type: 'deposit' },
    });

    const result = await detector.run({
      accountId: transaction.accountId,
      transactionId: transaction.id,
      txFingerprint: transaction.txFingerprint,
      transaction,
    });

    expect(assertOk(result).annotations).toEqual([]);
  });

  it('does not emit for transactions with both inflows and outflows', async () => {
    const detector = new BridgeParticipantDetector(createSeedProtocolCatalog());
    const transaction = makeTransaction({
      diagnostics: [
        {
          code: 'bridge_transfer',
          message: 'Bridge transfer.',
          severity: 'info',
          metadata: {
            bridgeFamily: 'wormhole',
          },
        },
      ],
      inflowCount: 1,
      outflowCount: 1,
      operation: { category: 'transfer', type: 'transfer' },
    });

    const result = await detector.run({
      accountId: transaction.accountId,
      transactionId: transaction.id,
      txFingerprint: transaction.txFingerprint,
      transaction,
    });

    expect(assertOk(result).annotations).toEqual([]);
  });
});
