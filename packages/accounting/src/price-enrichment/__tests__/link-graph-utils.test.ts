/**
 * Tests for link graph utility functions
 *
 * These tests verify the pure business logic for building transaction groups
 * using the Union-Find algorithm according to the "Functional Core, Imperative Shell" pattern
 */

import { type Currency, type UniversalTransactionData, parseDecimal } from '@exitbook/core';
import { describe, expect, it } from 'vitest';

import type { TransactionLink } from '../../linking/types.js';
import { buildLinkGraph } from '../link-graph-utils.js';

// Helper to create minimal test transactions
function createTx(
  id: number,
  source: string,
  sourceType: 'exchange' | 'blockchain',
  options: { blockchain?: string; datetime?: string } = {}
): UniversalTransactionData {
  const base: UniversalTransactionData = {
    id,
    accountId: 1,
    externalId: `ext-${id}`,
    source,
    sourceType,
    datetime: options.datetime ?? '2023-01-01T00:00:00Z',
    timestamp: Date.parse(options.datetime ?? '2023-01-01T00:00:00Z'),
    status: 'success',
    movements: {
      inflows: [{ assetId: 'test:btc', assetSymbol: 'BTC' as Currency, grossAmount: parseDecimal('1.0') }],
    },
    fees: [],
    operation: { category: 'transfer', type: 'deposit' },
  };

  if (options.blockchain) {
    return {
      ...base,
      blockchain: {
        name: options.blockchain,
        transaction_hash: `hash-${id}`,
        is_confirmed: true,
      },
    };
  }

  return base;
}

// Helper to create transaction links
function createLink(
  sourceName: number,
  targetId: number,
  status: 'suggested' | 'confirmed' | 'rejected' = 'confirmed'
): TransactionLink {
  return {
    id: targetId,
    sourceTransactionId: sourceName,
    targetTransactionId: targetId,
    assetSymbol: 'BTC' as Currency,
    sourceAssetId: 'test:btc',
    targetAssetId: 'test:btc',
    sourceAmount: parseDecimal('1.0'),
    targetAmount: parseDecimal('1.0'),
    linkType: 'exchange_to_blockchain',
    confidenceScore: parseDecimal('0.95'),
    matchCriteria: {
      assetMatch: true,
      amountSimilarity: parseDecimal('1.0'),
      timingValid: true,
      timingHours: 0.5,
    },
    status,
    createdAt: new Date('2023-01-01T00:00:00Z'),
    updatedAt: new Date('2023-01-01T00:00:00Z'),
  };
}

describe('buildLinkGraph', () => {
  describe('empty and single transaction cases', () => {
    it('returns empty array for no transactions', () => {
      const groups = buildLinkGraph([], []);
      expect(groups).toEqual([]);
    });

    it('creates single group for single transaction', () => {
      const tx = createTx(1, 'kraken', 'exchange');
      const groups = buildLinkGraph([tx], []);

      expect(groups).toHaveLength(1);
      expect(groups[0]!.transactions).toEqual([tx]);
      expect(groups[0]!.sources.size).toBe(1);
      expect(groups[0]!.sources.has('kraken')).toBe(true);
      expect(groups[0]!.linkChain).toEqual([]);
    });
  });

  describe('exchange transaction grouping (Phase 1 backward compatibility)', () => {
    it('groups all transactions from same exchange together', () => {
      const tx1 = createTx(1, 'kraken', 'exchange', { datetime: '2023-01-01T10:00:00Z' });
      const tx2 = createTx(2, 'kraken', 'exchange', { datetime: '2023-01-01T11:00:00Z' });
      const tx3 = createTx(3, 'kraken', 'exchange', { datetime: '2023-01-01T12:00:00Z' });

      const groups = buildLinkGraph([tx1, tx2, tx3], []);

      // All should be in one group
      expect(groups).toHaveLength(1);
      expect(groups[0]!.transactions).toHaveLength(3);
      expect(groups[0]!.transactions).toContainEqual(tx1);
      expect(groups[0]!.transactions).toContainEqual(tx2);
      expect(groups[0]!.transactions).toContainEqual(tx3);
      expect(groups[0]!.sources.size).toBe(1);
      expect(groups[0]!.sources.has('kraken')).toBe(true);
    });

    it('does NOT group transactions from different exchanges', () => {
      const tx1 = createTx(1, 'kraken', 'exchange');
      const tx2 = createTx(2, 'coinbase', 'exchange');
      const tx3 = createTx(3, 'kucoin', 'exchange');

      const groups = buildLinkGraph([tx1, tx2, tx3], []);

      // Each exchange should have its own group
      expect(groups).toHaveLength(3);

      // Verify each transaction is in its own group
      for (const group of groups) {
        expect(group.transactions).toHaveLength(1);
        expect(group.sources.size).toBe(1);
      }
    });
  });

  describe('blockchain transaction isolation (prevents price leakage)', () => {
    it('does NOT auto-group blockchain transactions from same chain', () => {
      const tx1 = createTx(1, 'bitcoin-blockstream', 'blockchain', { blockchain: 'bitcoin' });
      const tx2 = createTx(2, 'bitcoin-blockstream', 'blockchain', { blockchain: 'bitcoin' });
      const tx3 = createTx(3, 'bitcoin-blockstream', 'blockchain', { blockchain: 'bitcoin' });

      const groups = buildLinkGraph([tx1, tx2, tx3], []);

      // Each blockchain tx should be isolated (different wallets)
      expect(groups).toHaveLength(3);

      for (const group of groups) {
        expect(group.transactions).toHaveLength(1);
        expect(group.sources.size).toBe(1);
      }
    });

    it('keeps blockchain and exchange transactions separate without links', () => {
      const exchangeTx1 = createTx(1, 'kraken', 'exchange');
      const exchangeTx2 = createTx(2, 'kraken', 'exchange');
      const blockchainTx = createTx(3, 'bitcoin-blockstream', 'blockchain', { blockchain: 'bitcoin' });

      const groups = buildLinkGraph([exchangeTx1, exchangeTx2, blockchainTx], []);

      // Exchange txs grouped together, blockchain tx separate
      expect(groups).toHaveLength(2);

      const krakenGroup = groups.find((g) => g.sources.has('kraken'));
      const bitcoinGroup = groups.find((g) => g.sources.has('bitcoin-blockstream'));

      expect(krakenGroup?.transactions).toHaveLength(2);
      expect(bitcoinGroup?.transactions).toHaveLength(1);
    });
  });

  describe('cross-platform linking (Phase 2 functionality)', () => {
    it('groups transactions connected by confirmed links', () => {
      const tx1 = createTx(1, 'kraken', 'exchange');
      const tx2 = createTx(2, 'bitcoin-blockstream', 'blockchain', { blockchain: 'bitcoin' });
      const link = createLink(1, 2, 'confirmed');

      const groups = buildLinkGraph([tx1, tx2], [link]);

      // Should be grouped together via confirmed link
      expect(groups).toHaveLength(1);
      expect(groups[0]!.transactions).toHaveLength(2);
      expect(groups[0]!.sources.size).toBe(2);
      expect(groups[0]!.sources.has('kraken')).toBe(true);
      expect(groups[0]!.sources.has('bitcoin-blockstream')).toBe(true);
      expect(groups[0]!.linkChain).toEqual([link]);
    });

    it('does NOT group transactions with suggested links', () => {
      const tx1 = createTx(1, 'kraken', 'exchange');
      const tx2 = createTx(2, 'bitcoin-blockstream', 'blockchain', { blockchain: 'bitcoin' });
      const link = createLink(1, 2, 'suggested');

      const groups = buildLinkGraph([tx1, tx2], [link]);

      // Should remain separate (suggested links not used for grouping)
      expect(groups).toHaveLength(2);
    });

    it('does NOT group transactions with rejected links', () => {
      const tx1 = createTx(1, 'kraken', 'exchange');
      const tx2 = createTx(2, 'bitcoin-blockstream', 'blockchain', { blockchain: 'bitcoin' });
      const link = createLink(1, 2, 'rejected');

      const groups = buildLinkGraph([tx1, tx2], [link]);

      // Should remain separate (rejected links ignored)
      expect(groups).toHaveLength(2);
    });
  });

  describe('transitive linking', () => {
    it('groups transitively linked transactions (A→B, B→C → all in one group)', () => {
      const tx1 = createTx(1, 'kraken', 'exchange');
      const tx2 = createTx(2, 'bitcoin-blockstream', 'blockchain', { blockchain: 'bitcoin' });
      const tx3 = createTx(3, 'ethereum-alchemy', 'blockchain', { blockchain: 'ethereum' });

      const link1 = createLink(1, 2, 'confirmed'); // kraken → bitcoin
      const link2 = createLink(2, 3, 'confirmed'); // bitcoin → ethereum

      const groups = buildLinkGraph([tx1, tx2, tx3], [link1, link2]);

      // All three should be in one group due to transitive linking
      expect(groups).toHaveLength(1);
      expect(groups[0]!.transactions).toHaveLength(3);
      expect(groups[0]!.sources.size).toBe(3);
      expect(groups[0]!.linkChain).toHaveLength(2);
    });

    it('handles complex transitive linking across multiple exchanges and blockchains', () => {
      // Create a complex scenario:
      // Exchange cluster: kraken (tx1, tx2) auto-grouped
      // Blockchain txs: bitcoin (tx3), ethereum (tx4), separate initially
      // Links: kraken tx1 → bitcoin tx3, bitcoin tx3 → ethereum tx4
      // Result: All 4 should be in one group
      const tx1 = createTx(1, 'kraken', 'exchange');
      const tx2 = createTx(2, 'kraken', 'exchange');
      const tx3 = createTx(3, 'bitcoin-blockstream', 'blockchain', { blockchain: 'bitcoin' });
      const tx4 = createTx(4, 'ethereum-alchemy', 'blockchain', { blockchain: 'ethereum' });

      const link1 = createLink(1, 3, 'confirmed'); // kraken tx1 → bitcoin
      const link2 = createLink(3, 4, 'confirmed'); // bitcoin → ethereum

      const groups = buildLinkGraph([tx1, tx2, tx3, tx4], [link1, link2]);

      // All should be in one group
      expect(groups).toHaveLength(1);
      expect(groups[0]!.transactions).toHaveLength(4);
      expect(groups[0]!.sources.size).toBe(3);
    });
  });

  describe('multiple disjoint groups', () => {
    it('creates separate groups for unconnected transaction clusters', () => {
      // Cluster 1: kraken transactions (auto-grouped)
      const tx1 = createTx(1, 'kraken', 'exchange');
      const tx2 = createTx(2, 'kraken', 'exchange');

      // Cluster 2: coinbase + linked bitcoin
      const tx3 = createTx(3, 'coinbase', 'exchange');
      const tx4 = createTx(4, 'bitcoin-blockstream', 'blockchain', { blockchain: 'bitcoin' });
      const link1 = createLink(3, 4, 'confirmed');

      // Cluster 3: isolated ethereum transaction
      const tx5 = createTx(5, 'ethereum-alchemy', 'blockchain', { blockchain: 'ethereum' });

      const groups = buildLinkGraph([tx1, tx2, tx3, tx4, tx5], [link1]);

      // Should have 3 groups
      expect(groups).toHaveLength(3);

      // Find each cluster
      const krakenGroup = groups.find((g) => g.sources.has('kraken'));
      const coinbaseGroup = groups.find((g) => g.sources.has('coinbase'));
      const ethereumGroup = groups.find((g) => g.sources.has('ethereum-alchemy'));

      expect(krakenGroup?.transactions).toHaveLength(2);
      expect(coinbaseGroup?.transactions).toHaveLength(2);
      expect(ethereumGroup?.transactions).toHaveLength(1);
    });
  });

  describe('edge cases', () => {
    it('ignores links to non-existent transactions', () => {
      const tx1 = createTx(1, 'kraken', 'exchange');
      const tx2 = createTx(2, 'coinbase', 'exchange');
      const validLink = createLink(1, 2, 'confirmed');
      const invalidLink = createLink(1, 999, 'confirmed'); // tx 999 doesn't exist

      const groups = buildLinkGraph([tx1, tx2], [validLink, invalidLink]);

      // Should still group tx1 and tx2, ignore invalid link
      expect(groups).toHaveLength(1);
      expect(groups[0]!.transactions).toHaveLength(2);
      expect(groups[0]!.linkChain).toEqual([validLink]); // Only valid link included
    });

    it('handles self-links gracefully', () => {
      const tx1 = createTx(1, 'kraken', 'exchange');
      const selfLink = createLink(1, 1, 'confirmed');

      const groups = buildLinkGraph([tx1], [selfLink]);

      // Should create one group with the transaction
      expect(groups).toHaveLength(1);
      expect(groups[0]!.transactions).toEqual([tx1]);
    });

    it('handles duplicate links gracefully', () => {
      const tx1 = createTx(1, 'kraken', 'exchange');
      const tx2 = createTx(2, 'bitcoin-blockstream', 'blockchain', { blockchain: 'bitcoin' });
      const link1 = createLink(1, 2, 'confirmed');
      const link2 = createLink(1, 2, 'confirmed'); // duplicate

      const groups = buildLinkGraph([tx1, tx2], [link1, link2]);

      // Should still create one group
      expect(groups).toHaveLength(1);
      expect(groups[0]!.transactions).toHaveLength(2);
    });
  });

  describe('group metadata', () => {
    it('assigns unique groupId to each group', () => {
      const tx1 = createTx(1, 'kraken', 'exchange');
      const tx2 = createTx(2, 'coinbase', 'exchange');

      const groups = buildLinkGraph([tx1, tx2], []);

      expect(groups).toHaveLength(2);
      expect(groups[0]!.groupId).toBeTruthy();
      expect(groups[1]!.groupId).toBeTruthy();
      expect(groups[0]!.groupId).not.toBe(groups[1]!.groupId);
    });

    it('includes all sources in group metadata', () => {
      const tx1 = createTx(1, 'kraken', 'exchange');
      const tx2 = createTx(2, 'kraken', 'exchange');
      const tx3 = createTx(3, 'bitcoin-blockstream', 'blockchain', { blockchain: 'bitcoin' });
      const link = createLink(1, 3, 'confirmed');

      const groups = buildLinkGraph([tx1, tx2, tx3], [link]);

      expect(groups).toHaveLength(1);
      expect(groups[0]!.sources.size).toBe(2);
      expect(groups[0]!.sources.has('kraken')).toBe(true);
      expect(groups[0]!.sources.has('bitcoin-blockstream')).toBe(true);
    });

    it('includes only confirmed links within the group in linkChain', () => {
      // Group 1: kraken tx1, tx2 (auto-grouped by exchange)
      const tx1 = createTx(1, 'kraken', 'exchange');
      const tx2 = createTx(2, 'kraken', 'exchange');

      // Group 2: bitcoin tx3, tx4 (separate group, linked together)
      const tx3 = createTx(3, 'bitcoin-blockstream', 'blockchain', { blockchain: 'bitcoin' });
      const tx4 = createTx(4, 'bitcoin-blockstream', 'blockchain', { blockchain: 'bitcoin' });

      const group2Link = createLink(3, 4, 'confirmed'); // links tx3 and tx4
      const suggestedLink = createLink(1, 2, 'suggested'); // not included (suggested)
      const rejectedLink = createLink(1, 3, 'rejected'); // not included (rejected, different group)

      const groups = buildLinkGraph([tx1, tx2, tx3, tx4], [group2Link, suggestedLink, rejectedLink]);

      // Should have 2 groups
      expect(groups).toHaveLength(2);

      // Group 1 (kraken) should have no confirmed links (tx1, tx2 auto-grouped by exchange)
      const group1 = groups.find((g) => g.sources.has('kraken'));
      expect(group1?.linkChain).toHaveLength(0);

      // Group 2 (bitcoin) should have one confirmed link (3→4)
      const group2 = groups.find((g) => g.transactions.some((tx) => tx.id === 3));
      expect(group2?.linkChain).toHaveLength(1);
      expect(group2?.linkChain[0]).toEqual(group2Link);
    });
  });

  describe('realistic scenarios', () => {
    it('handles typical user workflow: exchange → blockchain withdrawal → exchange deposit', () => {
      // User sells BTC on Kraken
      const krakenSell = createTx(1, 'kraken', 'exchange', { datetime: '2023-01-01T10:00:00Z' });

      // Withdraws to their Bitcoin wallet
      const krakenWithdrawal = createTx(2, 'kraken', 'exchange', { datetime: '2023-01-01T10:05:00Z' });
      const bitcoinDeposit = createTx(3, 'bitcoin-blockstream', 'blockchain', {
        blockchain: 'bitcoin',
        datetime: '2023-01-01T10:10:00Z',
      });

      // Later, transfers to Coinbase
      const bitcoinWithdrawal = createTx(4, 'bitcoin-blockstream', 'blockchain', {
        blockchain: 'bitcoin',
        datetime: '2023-01-02T14:00:00Z',
      });
      const coinbaseDeposit = createTx(5, 'coinbase', 'exchange', { datetime: '2023-01-02T14:15:00Z' });

      const links = [
        createLink(2, 3, 'confirmed'), // kraken withdrawal → bitcoin deposit
        createLink(3, 4, 'confirmed'), // bitcoin deposit → bitcoin withdrawal (same wallet)
        createLink(4, 5, 'confirmed'), // bitcoin withdrawal → coinbase deposit
      ];

      const groups = buildLinkGraph(
        [krakenSell, krakenWithdrawal, bitcoinDeposit, bitcoinWithdrawal, coinbaseDeposit],
        links
      );

      // All should be in one group (transitively linked via bitcoin wallet)
      expect(groups).toHaveLength(1);
      expect(groups[0]!.transactions).toHaveLength(5);
      expect(groups[0]!.sources.size).toBe(3);
      expect(groups[0]!.sources.has('kraken')).toBe(true);
      expect(groups[0]!.sources.has('bitcoin-blockstream')).toBe(true);
      expect(groups[0]!.sources.has('coinbase')).toBe(true);
    });

    it('maintains separation between different users wallets on same blockchain', () => {
      // User A's transactions
      const userABitcoin1 = createTx(1, 'bitcoin-blockstream', 'blockchain', { blockchain: 'bitcoin' });
      const userABitcoin2 = createTx(2, 'bitcoin-blockstream', 'blockchain', { blockchain: 'bitcoin' });

      // User B's transactions (should NOT be grouped with User A)
      const userBBitcoin1 = createTx(3, 'bitcoin-blockstream', 'blockchain', { blockchain: 'bitcoin' });

      const groups = buildLinkGraph([userABitcoin1, userABitcoin2, userBBitcoin1], []);

      // Each bitcoin tx should be isolated
      expect(groups).toHaveLength(3);
    });
  });
});
