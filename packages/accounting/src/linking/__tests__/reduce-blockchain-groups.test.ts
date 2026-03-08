import type { Currency } from '@exitbook/core';
import { parseDecimal } from '@exitbook/core';
import type { Logger } from '@exitbook/logger';
import { describe, expect, it, vi } from 'vitest';

import { groupSameHashTransactions } from '../pre-linking/group-same-hash-transactions.js';
import { reduceBlockchainGroups } from '../pre-linking/reduce-blockchain-groups.js';

import { createTransaction } from './test-utils.js';

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  error: vi.fn(),
  trace: vi.fn(),
} as unknown as Logger;

describe('reduceBlockchainGroups', () => {
  it('produces no internal links for outflow-only hash groups', () => {
    // Two wallets co-spending in same UTXO transaction — external send, not internal transfer
    const transactions = [
      createTransaction({
        id: 1,
        accountId: 1,
        source: 'blockchain:bitcoin',
        sourceType: 'blockchain',
        datetime: '2026-01-01T00:00:00Z',
        outflows: [{ assetSymbol: 'BTC', amount: '0.5' }],
        blockchain: { name: 'bitcoin', transaction_hash: '0xhash1', is_confirmed: true },
      }),
      createTransaction({
        id: 2,
        accountId: 2,
        source: 'blockchain:bitcoin',
        sourceType: 'blockchain',
        datetime: '2026-01-01T00:00:00Z',
        outflows: [{ assetSymbol: 'BTC', amount: '0.3' }],
        blockchain: { name: 'bitcoin', transaction_hash: '0xhash1', is_confirmed: true },
      }),
    ];

    const groups = groupSameHashTransactions(transactions);
    const result = reduceBlockchainGroups(groups, logger);

    expect(result.internalLinks).toHaveLength(0);
    expect(result.outflowReductions.size).toBe(0);
    expect(result.internalTxIds.size).toBe(0);
  });

  it('produces internal links for clear wallet-to-wallet transfer (one outflow, one inflow)', () => {
    const transactions = [
      createTransaction({
        id: 1,
        accountId: 1,
        source: 'blockchain:ethereum',
        sourceType: 'blockchain',
        datetime: '2026-01-01T00:00:00Z',
        outflows: [{ assetSymbol: 'ETH', amount: '5' }],
        blockchain: { name: 'ethereum', transaction_hash: '0xabc', is_confirmed: true },
      }),
      createTransaction({
        id: 2,
        accountId: 2,
        source: 'blockchain:ethereum',
        sourceType: 'blockchain',
        datetime: '2026-01-01T00:00:00Z',
        inflows: [{ assetSymbol: 'ETH', amount: '5' }],
        blockchain: { name: 'ethereum', transaction_hash: '0xabc', is_confirmed: true },
      }),
    ];

    const groups = groupSameHashTransactions(transactions);
    const result = reduceBlockchainGroups(groups, logger);

    expect(result.internalLinks).toHaveLength(1);
    expect(result.internalLinks[0]).toMatchObject({
      sourceTransactionId: 1,
      targetTransactionId: 2,
      assetSymbol: 'ETH',
      linkType: 'blockchain_internal',
      status: 'confirmed',
    });
    expect(result.internalTxIds).toEqual(new Set([1, 2]));
  });

  it('reduces outflow amount by tracked inflows and deduped fee', () => {
    const transactions = [
      createTransaction({
        id: 1,
        accountId: 1,
        source: 'blockchain:bitcoin',
        sourceType: 'blockchain',
        datetime: '2026-01-01T00:00:00Z',
        outflows: [{ assetSymbol: 'BTC', amount: '10', netAmount: '9.999' }],
        blockchain: { name: 'bitcoin', transaction_hash: '0xbtc1', is_confirmed: true },
      }),
      createTransaction({
        id: 2,
        accountId: 2,
        source: 'blockchain:bitcoin',
        sourceType: 'blockchain',
        datetime: '2026-01-01T00:00:00Z',
        inflows: [{ assetSymbol: 'BTC', amount: '3' }],
        blockchain: { name: 'bitcoin', transaction_hash: '0xbtc1', is_confirmed: true },
      }),
    ];
    // Add fee to sender
    transactions[0]!.fees = [
      {
        assetId: 'test:btc',
        assetSymbol: 'BTC' as Currency,
        amount: parseDecimal('0.001'),
        scope: 'network',
        settlement: 'on-chain',
      },
    ];

    const groups = groupSameHashTransactions(transactions);
    const result = reduceBlockchainGroups(groups, logger);

    // Reduced: 10 - 3 - 0.001 = 6.999
    const reduction = result.outflowReductions.get(1)?.get('test:btc');
    expect(reduction?.toFixed()).toBe('6.999');
  });

  it('does not group same-symbol movements with different assetIds', () => {
    const transactions = [
      createTransaction({
        id: 1,
        accountId: 1,
        source: 'blockchain:ethereum',
        sourceType: 'blockchain',
        datetime: '2026-01-01T00:00:00Z',
        outflows: [{ assetId: 'blockchain:ethereum:0xa0b8', assetSymbol: 'USDC', amount: '10' }],
        blockchain: { name: 'ethereum', transaction_hash: '0xassetid', is_confirmed: true },
      }),
      createTransaction({
        id: 2,
        accountId: 2,
        source: 'blockchain:ethereum',
        sourceType: 'blockchain',
        datetime: '2026-01-01T00:00:00Z',
        inflows: [{ assetId: 'blockchain:ethereum:0xfake', assetSymbol: 'USDC', amount: '10' }],
        blockchain: { name: 'ethereum', transaction_hash: '0xassetid', is_confirmed: true },
      }),
    ];

    const groups = groupSameHashTransactions(transactions);

    expect(groups).toHaveLength(0);
  });

  it('emits warning and skips links for multi-outflow + inflow ambiguous groups', () => {
    const transactions = [
      createTransaction({
        id: 1,
        accountId: 1,
        source: 'blockchain:bitcoin',
        sourceType: 'blockchain',
        datetime: '2026-01-01T00:00:00Z',
        outflows: [{ assetSymbol: 'BTC', amount: '2' }],
        blockchain: { name: 'bitcoin', transaction_hash: '0xambig', is_confirmed: true },
      }),
      createTransaction({
        id: 2,
        accountId: 2,
        source: 'blockchain:bitcoin',
        sourceType: 'blockchain',
        datetime: '2026-01-01T00:00:00Z',
        outflows: [{ assetSymbol: 'BTC', amount: '3' }],
        blockchain: { name: 'bitcoin', transaction_hash: '0xambig', is_confirmed: true },
      }),
      createTransaction({
        id: 3,
        accountId: 3,
        source: 'blockchain:bitcoin',
        sourceType: 'blockchain',
        datetime: '2026-01-01T00:00:00Z',
        inflows: [{ assetSymbol: 'BTC', amount: '4.5' }],
        blockchain: { name: 'bitcoin', transaction_hash: '0xambig', is_confirmed: true },
      }),
    ];

    const groups = groupSameHashTransactions(transactions);
    const result = reduceBlockchainGroups(groups, logger);

    expect(result.internalLinks).toHaveLength(0);
    expect(result.outflowReductions.size).toBe(0);
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Vitest mock assertion
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      expect.objectContaining({ outflowTxIds: [1, 2] }),
      expect.stringContaining('multiple outflow participants')
    );
  });

  it('emits warning and skips links for mixed inflow/outflow on same participant', () => {
    const transactions = [
      createTransaction({
        id: 1,
        accountId: 1,
        source: 'blockchain:ethereum',
        sourceType: 'blockchain',
        datetime: '2026-01-01T00:00:00Z',
        outflows: [{ assetSymbol: 'ETH', amount: '5' }],
        inflows: [{ assetSymbol: 'ETH', amount: '0.5' }],
        blockchain: { name: 'ethereum', transaction_hash: '0xmixed', is_confirmed: true },
      }),
      createTransaction({
        id: 2,
        accountId: 2,
        source: 'blockchain:ethereum',
        sourceType: 'blockchain',
        datetime: '2026-01-01T00:00:00Z',
        inflows: [{ assetSymbol: 'ETH', amount: '4.5' }],
        blockchain: { name: 'ethereum', transaction_hash: '0xmixed', is_confirmed: true },
      }),
    ];

    const groups = groupSameHashTransactions(transactions);
    const result = reduceBlockchainGroups(groups, logger);

    expect(result.internalLinks).toHaveLength(0);
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Vitest mock assertion
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      expect.objectContaining({ mixedTxIds: [1] }),
      expect.stringContaining('both inflows and outflows')
    );
  });

  it('handles account-model blockchain transfer unchanged', () => {
    // Standard EVM internal transfer: one sender, one receiver, same hash
    const transactions = [
      createTransaction({
        id: 10,
        accountId: 5,
        source: 'blockchain:ethereum',
        sourceType: 'blockchain',
        datetime: '2026-02-01T00:00:00Z',
        outflows: [{ assetSymbol: 'USDC', amount: '1000' }],
        blockchain: { name: 'ethereum', transaction_hash: '0xevm1', is_confirmed: true },
      }),
      createTransaction({
        id: 11,
        accountId: 6,
        source: 'blockchain:ethereum',
        sourceType: 'blockchain',
        datetime: '2026-02-01T00:00:00Z',
        inflows: [{ assetSymbol: 'USDC', amount: '1000' }],
        blockchain: { name: 'ethereum', transaction_hash: '0xevm1', is_confirmed: true },
      }),
    ];

    const groups = groupSameHashTransactions(transactions);
    const result = reduceBlockchainGroups(groups, logger);

    expect(result.internalLinks).toHaveLength(1);
    expect(result.internalLinks[0]).toMatchObject({
      sourceTransactionId: 10,
      targetTransactionId: 11,
      assetSymbol: 'USDC',
      linkType: 'blockchain_internal',
    });
  });

  it('handles one outflow with multiple inflow receivers', () => {
    const transactions = [
      createTransaction({
        id: 1,
        accountId: 1,
        source: 'blockchain:bitcoin',
        sourceType: 'blockchain',
        datetime: '2026-01-01T00:00:00Z',
        outflows: [{ assetSymbol: 'BTC', amount: '10' }],
        blockchain: { name: 'bitcoin', transaction_hash: '0xmulti', is_confirmed: true },
      }),
      createTransaction({
        id: 2,
        accountId: 2,
        source: 'blockchain:bitcoin',
        sourceType: 'blockchain',
        datetime: '2026-01-01T00:00:00Z',
        inflows: [{ assetSymbol: 'BTC', amount: '4' }],
        blockchain: { name: 'bitcoin', transaction_hash: '0xmulti', is_confirmed: true },
      }),
      createTransaction({
        id: 3,
        accountId: 3,
        source: 'blockchain:bitcoin',
        sourceType: 'blockchain',
        datetime: '2026-01-01T00:00:00Z',
        inflows: [{ assetSymbol: 'BTC', amount: '5' }],
        blockchain: { name: 'bitcoin', transaction_hash: '0xmulti', is_confirmed: true },
      }),
    ];

    const groups = groupSameHashTransactions(transactions);
    const result = reduceBlockchainGroups(groups, logger);

    expect(result.internalLinks).toHaveLength(2);
    expect(result.internalLinks.map((l) => l.targetTransactionId).sort()).toEqual([2, 3]);
    expect(result.internalLinks.find((link) => link.targetTransactionId === 2)?.sourceAmount.toFixed()).toBe('10');
    expect(result.internalLinks.find((link) => link.targetTransactionId === 2)?.targetAmount.toFixed()).toBe('4');
    expect(result.internalLinks.find((link) => link.targetTransactionId === 3)?.sourceAmount.toFixed()).toBe('10');
    expect(result.internalLinks.find((link) => link.targetTransactionId === 3)?.targetAmount.toFixed()).toBe('5');

    // Reduction: 10 - 4 - 5 = 1
    const reduction = result.outflowReductions.get(1)?.get('test:btc');
    expect(reduction?.toFixed()).toBe('1');
  });

  it('skips internal reduction when a participant has multiple same-asset movements', () => {
    const transactions = [
      createTransaction({
        id: 1,
        accountId: 1,
        source: 'blockchain:bitcoin',
        sourceType: 'blockchain',
        datetime: '2026-01-01T00:00:00Z',
        outflows: [
          { assetSymbol: 'BTC', amount: '6' },
          { assetSymbol: 'BTC', amount: '4' },
        ],
        blockchain: { name: 'bitcoin', transaction_hash: '0xmultiout', is_confirmed: true },
      }),
      createTransaction({
        id: 2,
        accountId: 2,
        source: 'blockchain:bitcoin',
        sourceType: 'blockchain',
        datetime: '2026-01-01T00:00:00Z',
        inflows: [{ assetSymbol: 'BTC', amount: '9' }],
        blockchain: { name: 'bitcoin', transaction_hash: '0xmultiout', is_confirmed: true },
      }),
    ];

    const groups = groupSameHashTransactions(transactions);
    const result = reduceBlockchainGroups(groups, logger);

    expect(result.internalLinks).toHaveLength(0);
    expect(result.outflowReductions.size).toBe(0);
    // eslint-disable-next-line @typescript-eslint/unbound-method -- acceptable here
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      expect.objectContaining({ senderOutflowMovementCount: 2 }),
      expect.stringContaining('multiple movements for the same asset')
    );
  });
});
