import type { Currency } from '@exitbook/core';
import { parseDecimal } from '@exitbook/core';
import { assertOk } from '@exitbook/core/test-utils';
import type { Logger } from '@exitbook/logger';
import { describe, expect, it, vi } from 'vitest';

import { createTransaction, requirePresent } from '../../shared/test-utils.js';
import { buildLinkableMovements } from '../build-linkable-movements.js';

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  error: vi.fn(),
  trace: vi.fn(),
} as unknown as Logger;

describe('buildLinkableMovements', () => {
  it('creates linkable movements for inflows and outflows', () => {
    const transactions = [
      createTransaction({
        id: 1,
        source: 'kraken',
        sourceType: 'exchange',
        datetime: '2026-01-01T00:00:00Z',
        outflows: [{ assetSymbol: 'BTC', amount: '1' }],
      }),
      createTransaction({
        id: 2,
        source: 'blockchain:bitcoin',
        sourceType: 'blockchain',
        datetime: '2026-01-01T01:00:00Z',
        inflows: [{ assetSymbol: 'BTC', amount: '0.999' }],
        blockchain: { name: 'bitcoin', transaction_hash: '0xabc', is_confirmed: true },
      }),
    ];

    const result = assertOk(buildLinkableMovements(transactions, logger));

    expect(result.linkableMovements).toHaveLength(2);
    expect(result.linkableMovements[0]).toMatchObject({
      transactionId: 1,
      direction: 'out',
      assetSymbol: 'BTC',
    });
    expect(result.linkableMovements[1]).toMatchObject({
      transactionId: 2,
      direction: 'in',
      assetSymbol: 'BTC',
    });
  });

  it('reuses persisted movement fingerprints without exposing linkable positions', () => {
    const transactions = [
      createTransaction({
        id: 1,
        source: 'kraken',
        sourceType: 'exchange',
        datetime: '2026-01-01T00:00:00Z',
        inflows: [
          { assetSymbol: 'ETH', amount: '1' },
          { assetSymbol: 'USDT', amount: '100' },
        ],
        outflows: [
          { assetSymbol: 'BTC', amount: '0.5' },
          { assetSymbol: 'SOL', amount: '10' },
        ],
      }),
    ];
    const firstInflow = requirePresent(transactions[0]!.movements.inflows?.[0], 'Expected first inflow');
    const secondInflow = requirePresent(transactions[0]!.movements.inflows?.[1], 'Expected second inflow');
    const firstOutflow = requirePresent(transactions[0]!.movements.outflows?.[0], 'Expected first outflow');
    const secondOutflow = requirePresent(transactions[0]!.movements.outflows?.[1], 'Expected second outflow');

    const result = assertOk(buildLinkableMovements(transactions, logger));

    expect(
      result.linkableMovements.map((candidate) => ({
        assetSymbol: candidate.assetSymbol,
        direction: candidate.direction,
        movementFingerprint: candidate.movementFingerprint,
      }))
    ).toEqual([
      {
        assetSymbol: 'ETH',
        direction: 'in',
        movementFingerprint: firstInflow.movementFingerprint,
      },
      {
        assetSymbol: 'USDT',
        direction: 'in',
        movementFingerprint: secondInflow.movementFingerprint,
      },
      {
        assetSymbol: 'BTC',
        direction: 'out',
        movementFingerprint: firstOutflow.movementFingerprint,
      },
      {
        assetSymbol: 'SOL',
        direction: 'out',
        movementFingerprint: secondOutflow.movementFingerprint,
      },
    ]);
  });

  it('uses persisted movement fingerprints instead of recomputing them', () => {
    const transaction = createTransaction({
      id: 7,
      source: 'kraken',
      sourceType: 'exchange',
      datetime: '2026-01-01T00:00:00Z',
      outflows: [{ assetSymbol: 'BTC', amount: '1' }],
    });
    transaction.txFingerprint = 'f'.repeat(64);
    transaction.movements.outflows![0]!.movementFingerprint = 'movement:stored:outflow:0';

    const result = assertOk(buildLinkableMovements([transaction], logger));

    expect(result.linkableMovements[0]?.movementFingerprint).toBe('movement:stored:outflow:0');
  });

  it('marks structural trades as excluded', () => {
    const transactions = [
      createTransaction({
        id: 1,
        source: 'kraken',
        sourceType: 'exchange',
        datetime: '2026-01-01T00:00:00Z',
        outflows: [{ assetSymbol: 'USDT', amount: '1000' }],
        inflows: [{ assetSymbol: 'ETH', amount: '0.5' }],
      }),
    ];

    const result = assertOk(buildLinkableMovements(transactions, logger));

    expect(result.linkableMovements).toHaveLength(2);
    expect(result.linkableMovements.every((candidate) => candidate.excluded)).toBe(true);
  });

  it('does not mark same-asset inflow+outflow as structural trade', () => {
    const transactions = [
      createTransaction({
        id: 1,
        source: 'blockchain:near',
        sourceType: 'blockchain',
        datetime: '2026-01-01T00:00:00Z',
        outflows: [{ assetSymbol: 'NEAR', amount: '10' }],
        inflows: [{ assetSymbol: 'NEAR', amount: '0.1' }],
        blockchain: { name: 'near', transaction_hash: '0xnear1', is_confirmed: true },
      }),
    ];

    const result = assertOk(buildLinkableMovements(transactions, logger));

    expect(result.linkableMovements.every((candidate) => !candidate.excluded)).toBe(true);
  });

  it('produces internal links and reduces outflow for clear internal transfer', () => {
    const transactions = [
      createTransaction({
        id: 1,
        accountId: 1,
        source: 'blockchain:ethereum',
        sourceType: 'blockchain',
        datetime: '2026-01-01T00:00:00Z',
        outflows: [{ assetSymbol: 'ETH', amount: '5', netAmount: '4.99' }],
        blockchain: { name: 'ethereum', transaction_hash: '0xint', is_confirmed: true },
      }),
      createTransaction({
        id: 2,
        accountId: 2,
        source: 'blockchain:ethereum',
        sourceType: 'blockchain',
        datetime: '2026-01-01T00:00:00Z',
        inflows: [{ assetSymbol: 'ETH', amount: '3' }],
        blockchain: { name: 'ethereum', transaction_hash: '0xint', is_confirmed: true },
      }),
    ];
    transactions[0]!.fees = [
      {
        assetId: 'test:eth',
        assetSymbol: 'ETH' as Currency,
        amount: parseDecimal('0.01'),
        movementFingerprint: 'movement:test:eth:fee:0',
        scope: 'network',
        settlement: 'on-chain',
      },
    ];
    const sourceMovementFingerprint = requirePresent(
      transactions[0]!.movements.outflows?.[0]?.movementFingerprint,
      'Expected source outflow movement fingerprint'
    );
    const targetMovementFingerprint = requirePresent(
      transactions[1]!.movements.inflows?.[0]?.movementFingerprint,
      'Expected target inflow movement fingerprint'
    );

    const result = assertOk(buildLinkableMovements(transactions, logger));

    // Internal link created
    expect(result.internalLinks).toHaveLength(1);
    expect(result.internalLinks[0]).toMatchObject({
      sourceTransactionId: 1,
      targetTransactionId: 2,
      linkType: 'blockchain_internal',
      sourceMovementFingerprint,
      targetMovementFingerprint,
    });

    // Outflow candidate reduced from gross amounts: 5 - 3 - 0.01 = 1.99
    const outflow = result.linkableMovements.find((candidate) => candidate.direction === 'out');
    expect(outflow?.amount.toFixed()).toBe('1.99');

    // Both marked as internal
    expect(result.linkableMovements.every((candidate) => candidate.isInternal)).toBe(true);
  });

  it('builds linkable movements without any UTXO-only metadata fields', () => {
    const transactions = [
      createTransaction({
        id: 1,
        source: 'blockchain:bitcoin',
        sourceType: 'blockchain',
        datetime: '2026-01-01T00:00:00Z',
        outflows: [{ assetSymbol: 'BTC', amount: '1' }],
        blockchain: { name: 'bitcoin', transaction_hash: '0x1', is_confirmed: true },
      }),
    ];

    const result = assertOk(buildLinkableMovements(transactions, logger));

    expect(result.linkableMovements[0]).not.toHaveProperty('utxoGroupId');
  });

  it('normalizes blockchain tx hashes on linkable movements', () => {
    const transactions = [
      createTransaction({
        id: 1,
        source: 'blockchain:ethereum',
        sourceType: 'blockchain',
        datetime: '2026-01-01T00:00:00Z',
        inflows: [{ assetSymbol: 'ETH', amount: '1' }],
        blockchain: { name: 'ethereum', transaction_hash: '0xabc-819', is_confirmed: true },
      }),
    ];

    const result = assertOk(buildLinkableMovements(transactions, logger));

    expect(result.linkableMovements[0]?.blockchainTxHash).toBe('0xabc');
  });
});
