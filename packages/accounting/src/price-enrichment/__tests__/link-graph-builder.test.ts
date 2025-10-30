import { parseDecimal, type UniversalTransaction } from '@exitbook/core';
import { describe, expect, it } from 'vitest';

import type { TransactionLink } from '../../linking/types.js';
import { LinkGraphBuilder } from '../link-graph-builder.js';

/**
 * Helper to create a minimal UniversalTransaction for testing
 */
function createTransaction(params: {
  datetime: string;
  id: number;
  inflows?: { amount: string; asset: string }[];
  outflows?: { amount: string; asset: string }[];
  source: string;
}): UniversalTransaction {
  return {
    id: params.id,
    source: params.source,
    externalId: `${params.source}-${params.id}`,
    datetime: params.datetime,
    timestamp: new Date(params.datetime).getTime(),
    status: 'success',
    movements: {
      inflows: params.inflows ? params.inflows.map((m) => ({ asset: m.asset, amount: parseDecimal(m.amount) })) : [],
      outflows: params.outflows ? params.outflows.map((m) => ({ asset: m.asset, amount: parseDecimal(m.amount) })) : [],
    },
    fees: {},
    operation: {
      category: 'transfer',
      type: 'transfer',
    },
    ...(params.source !== 'kraken' && params.source !== 'coinbase'
      ? {
          blockchain: {
            name: params.source,
            transaction_hash: `hash-${params.id}`,
            is_confirmed: true,
          },
        }
      : {}),
  };
}

/**
 * Helper to create a TransactionLink for testing
 */
function createTransactionLink(params: {
  confidenceScore?: string;
  id: string;
  linkType: 'exchange_to_blockchain' | 'blockchain_to_blockchain' | 'exchange_to_exchange';
  sourceTransactionId: number;
  status: 'suggested' | 'confirmed' | 'rejected';
  targetTransactionId: number;
}): TransactionLink {
  return {
    id: params.id,
    sourceTransactionId: params.sourceTransactionId,
    targetTransactionId: params.targetTransactionId,
    linkType: params.linkType,
    confidenceScore: parseDecimal(params.confidenceScore ?? '0.95'),
    matchCriteria: {
      assetMatch: true,
      amountSimilarity: parseDecimal('1.0'),
      timingValid: true,
      timingHours: 1.0,
    },
    status: params.status,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe('LinkGraphBuilder', () => {
  describe('buildLinkGraph', () => {
    it('should return empty array when no transactions', () => {
      const builder = new LinkGraphBuilder();
      const groups = builder.buildLinkGraph([], []);

      expect(groups).toEqual([]);
    });

    it('should create single-transaction groups when no links exist', () => {
      const builder = new LinkGraphBuilder();

      const transactions: UniversalTransaction[] = [
        createTransaction({
          id: 1,
          source: 'kraken',
          datetime: '2024-01-01T12:00:00.000Z',
          outflows: [{ asset: 'BTC', amount: '1.0' }],
        }),
        createTransaction({
          id: 2,
          source: 'bitcoin',
          datetime: '2024-01-01T13:00:00.000Z',
          inflows: [{ asset: 'BTC', amount: '1.0' }],
        }),
        createTransaction({
          id: 3,
          source: 'ethereum',
          datetime: '2024-01-01T14:00:00.000Z',
          inflows: [{ asset: 'ETH', amount: '10.0' }],
        }),
      ];

      const groups = builder.buildLinkGraph(transactions, []);

      // Each transaction should be in its own group
      expect(groups).toHaveLength(3);

      for (const group of groups) {
        expect(group.transactions).toHaveLength(1);
        expect(group.sources.size).toBe(1);
        expect(group.linkChain).toHaveLength(0);
        expect(group.groupId).toBeTruthy(); // Has a UUID
      }
    });

    it('should group two transactions with a confirmed link', () => {
      const builder = new LinkGraphBuilder();

      const transactions: UniversalTransaction[] = [
        createTransaction({
          id: 1,
          source: 'kraken',
          datetime: '2024-01-01T12:00:00.000Z',
          outflows: [{ asset: 'BTC', amount: '1.0' }],
        }),
        createTransaction({
          id: 2,
          source: 'bitcoin',
          datetime: '2024-01-01T13:00:00.000Z',
          inflows: [{ asset: 'BTC', amount: '1.0' }],
        }),
      ];

      const links: TransactionLink[] = [
        createTransactionLink({
          id: 'link-1',
          sourceTransactionId: 1,
          targetTransactionId: 2,
          linkType: 'exchange_to_blockchain',
          status: 'confirmed',
        }),
      ];

      const groups = builder.buildLinkGraph(transactions, links);

      // Should create one group with both transactions
      expect(groups).toHaveLength(1);

      const group = groups[0]!;
      expect(group.transactions).toHaveLength(2);
      expect(group.sources).toEqual(new Set(['kraken', 'bitcoin']));
      expect(group.linkChain).toHaveLength(1);
      expect(group.linkChain[0]?.id).toBe('link-1');
    });

    it('should ignore suggested links (only use confirmed)', () => {
      const builder = new LinkGraphBuilder();

      const transactions: UniversalTransaction[] = [
        createTransaction({
          id: 1,
          source: 'kraken',
          datetime: '2024-01-01T12:00:00.000Z',
          outflows: [{ asset: 'BTC', amount: '1.0' }],
        }),
        createTransaction({
          id: 2,
          source: 'bitcoin',
          datetime: '2024-01-01T13:00:00.000Z',
          inflows: [{ asset: 'BTC', amount: '1.0' }],
        }),
      ];

      const links: TransactionLink[] = [
        createTransactionLink({
          id: 'link-1',
          sourceTransactionId: 1,
          targetTransactionId: 2,
          linkType: 'exchange_to_blockchain',
          status: 'suggested', // Suggested, not confirmed
        }),
      ];

      const groups = builder.buildLinkGraph(transactions, links);

      // Should create two separate groups since link is not confirmed
      expect(groups).toHaveLength(2);

      for (const group of groups) {
        expect(group.transactions).toHaveLength(1);
        expect(group.linkChain).toHaveLength(0);
      }
    });

    it('should ignore rejected links', () => {
      const builder = new LinkGraphBuilder();

      const transactions: UniversalTransaction[] = [
        createTransaction({
          id: 1,
          source: 'kraken',
          datetime: '2024-01-01T12:00:00.000Z',
          outflows: [{ asset: 'BTC', amount: '1.0' }],
        }),
        createTransaction({
          id: 2,
          source: 'bitcoin',
          datetime: '2024-01-01T13:00:00.000Z',
          inflows: [{ asset: 'BTC', amount: '1.0' }],
        }),
      ];

      const links: TransactionLink[] = [
        createTransactionLink({
          id: 'link-1',
          sourceTransactionId: 1,
          targetTransactionId: 2,
          linkType: 'exchange_to_blockchain',
          status: 'rejected',
        }),
      ];

      const groups = builder.buildLinkGraph(transactions, links);

      // Should create two separate groups since link is rejected
      expect(groups).toHaveLength(2);

      for (const group of groups) {
        expect(group.transactions).toHaveLength(1);
        expect(group.linkChain).toHaveLength(0);
      }
    });

    it('should handle multi-hop links (transitive grouping)', () => {
      const builder = new LinkGraphBuilder();

      const transactions: UniversalTransaction[] = [
        // Kraken withdrawal
        createTransaction({
          id: 1,
          source: 'kraken',
          datetime: '2024-01-01T12:00:00.000Z',
          outflows: [{ asset: 'BTC', amount: '1.0' }],
        }),
        // Bitcoin deposit
        createTransaction({
          id: 2,
          source: 'bitcoin',
          datetime: '2024-01-01T13:00:00.000Z',
          inflows: [{ asset: 'BTC', amount: '1.0' }],
        }),
        // Bitcoin send
        createTransaction({
          id: 3,
          source: 'bitcoin',
          datetime: '2024-01-01T14:00:00.000Z',
          outflows: [{ asset: 'BTC', amount: '0.5' }],
        }),
        // Ethereum receive (cross-chain via bridge)
        createTransaction({
          id: 4,
          source: 'ethereum',
          datetime: '2024-01-01T15:00:00.000Z',
          inflows: [{ asset: 'WBTC', amount: '0.5' }],
        }),
      ];

      const links: TransactionLink[] = [
        // Kraken → Bitcoin
        createTransactionLink({
          id: 'link-1',
          sourceTransactionId: 1,
          targetTransactionId: 2,
          linkType: 'exchange_to_blockchain',
          status: 'confirmed',
        }),
        // Bitcoin → Bitcoin (internal transfer)
        createTransactionLink({
          id: 'link-2',
          sourceTransactionId: 2,
          targetTransactionId: 3,
          linkType: 'blockchain_to_blockchain',
          status: 'confirmed',
        }),
        // Bitcoin → Ethereum (bridge)
        createTransactionLink({
          id: 'link-3',
          sourceTransactionId: 3,
          targetTransactionId: 4,
          linkType: 'blockchain_to_blockchain',
          status: 'confirmed',
        }),
      ];

      const groups = builder.buildLinkGraph(transactions, links);

      // All four transactions should be in one group (transitive linking)
      expect(groups).toHaveLength(1);

      const group = groups[0]!;
      expect(group.transactions).toHaveLength(4);
      expect(group.sources).toEqual(new Set(['kraken', 'bitcoin', 'ethereum']));
      expect(group.linkChain).toHaveLength(3);
    });

    it('should handle circular links (naturally via Union-Find)', () => {
      const builder = new LinkGraphBuilder();

      const transactions: UniversalTransaction[] = [
        createTransaction({
          id: 1,
          source: 'kraken',
          datetime: '2024-01-01T12:00:00.000Z',
          outflows: [{ asset: 'BTC', amount: '1.0' }],
        }),
        createTransaction({
          id: 2,
          source: 'bitcoin',
          datetime: '2024-01-01T13:00:00.000Z',
          inflows: [{ asset: 'BTC', amount: '1.0' }],
        }),
        createTransaction({
          id: 3,
          source: 'bitcoin',
          datetime: '2024-01-01T14:00:00.000Z',
          outflows: [{ asset: 'BTC', amount: '0.5' }],
        }),
      ];

      const links: TransactionLink[] = [
        createTransactionLink({
          id: 'link-1',
          sourceTransactionId: 1,
          targetTransactionId: 2,
          linkType: 'exchange_to_blockchain',
          status: 'confirmed',
        }),
        createTransactionLink({
          id: 'link-2',
          sourceTransactionId: 2,
          targetTransactionId: 3,
          linkType: 'blockchain_to_blockchain',
          status: 'confirmed',
        }),
        // Circular link back to 1 (shouldn't cause issues)
        createTransactionLink({
          id: 'link-3',
          sourceTransactionId: 3,
          targetTransactionId: 1,
          linkType: 'blockchain_to_blockchain',
          status: 'confirmed',
        }),
      ];

      const groups = builder.buildLinkGraph(transactions, links);

      // Should still group all transactions together (circular link doesn't break Union-Find)
      expect(groups).toHaveLength(1);

      const group = groups[0]!;
      expect(group.transactions).toHaveLength(3);
      expect(group.linkChain).toHaveLength(3);
    });

    it('should create separate groups for disconnected link chains', () => {
      const builder = new LinkGraphBuilder();

      const transactions: UniversalTransaction[] = [
        // Group 1: Kraken → Bitcoin
        createTransaction({
          id: 1,
          source: 'kraken',
          datetime: '2024-01-01T12:00:00.000Z',
          outflows: [{ asset: 'BTC', amount: '1.0' }],
        }),
        createTransaction({
          id: 2,
          source: 'bitcoin',
          datetime: '2024-01-01T13:00:00.000Z',
          inflows: [{ asset: 'BTC', amount: '1.0' }],
        }),
        // Group 2: Coinbase → Ethereum
        createTransaction({
          id: 3,
          source: 'coinbase',
          datetime: '2024-01-01T14:00:00.000Z',
          outflows: [{ asset: 'ETH', amount: '10.0' }],
        }),
        createTransaction({
          id: 4,
          source: 'ethereum',
          datetime: '2024-01-01T15:00:00.000Z',
          inflows: [{ asset: 'ETH', amount: '10.0' }],
        }),
        // Unlinked transaction
        createTransaction({
          id: 5,
          source: 'bitcoin',
          datetime: '2024-01-01T16:00:00.000Z',
          outflows: [{ asset: 'BTC', amount: '0.1' }],
        }),
      ];

      const links: TransactionLink[] = [
        createTransactionLink({
          id: 'link-1',
          sourceTransactionId: 1,
          targetTransactionId: 2,
          linkType: 'exchange_to_blockchain',
          status: 'confirmed',
        }),
        createTransactionLink({
          id: 'link-2',
          sourceTransactionId: 3,
          targetTransactionId: 4,
          linkType: 'exchange_to_blockchain',
          status: 'confirmed',
        }),
      ];

      const groups = builder.buildLinkGraph(transactions, links);

      // Should create 3 groups (two linked pairs + one unlinked)
      expect(groups).toHaveLength(3);

      // Find groups by size
      const groupsBy2 = groups.filter((g) => g.transactions.length === 2);
      const groupsBy1 = groups.filter((g) => g.transactions.length === 1);

      expect(groupsBy2).toHaveLength(2); // Two linked pairs
      expect(groupsBy1).toHaveLength(1); // One unlinked transaction

      // Verify each linked group has the right sources
      for (const group of groupsBy2) {
        expect(group.linkChain).toHaveLength(1);
        expect(group.sources.size).toBe(2); // One exchange + one blockchain
      }
    });

    it('should ignore links to transactions not in the transaction set', () => {
      const builder = new LinkGraphBuilder();

      const transactions: UniversalTransaction[] = [
        createTransaction({
          id: 1,
          source: 'kraken',
          datetime: '2024-01-01T12:00:00.000Z',
          outflows: [{ asset: 'BTC', amount: '1.0' }],
        }),
        createTransaction({
          id: 2,
          source: 'bitcoin',
          datetime: '2024-01-01T13:00:00.000Z',
          inflows: [{ asset: 'BTC', amount: '1.0' }],
        }),
      ];

      const links: TransactionLink[] = [
        // Valid link
        createTransactionLink({
          id: 'link-1',
          sourceTransactionId: 1,
          targetTransactionId: 2,
          linkType: 'exchange_to_blockchain',
          status: 'confirmed',
        }),
        // Link to non-existent transaction (ID 999)
        createTransactionLink({
          id: 'link-2',
          sourceTransactionId: 2,
          targetTransactionId: 999,
          linkType: 'blockchain_to_blockchain',
          status: 'confirmed',
        }),
      ];

      const groups = builder.buildLinkGraph(transactions, links);

      // Should create 1 group with the two valid transactions
      expect(groups).toHaveLength(1);

      const group = groups[0]!;
      expect(group.transactions).toHaveLength(2);
      expect(group.linkChain).toHaveLength(1); // Only the valid link
      expect(group.linkChain[0]?.id).toBe('link-1');
    });

    it('should handle mixed link types in same group', () => {
      const builder = new LinkGraphBuilder();

      const transactions: UniversalTransaction[] = [
        // Exchange 1
        createTransaction({
          id: 1,
          source: 'kraken',
          datetime: '2024-01-01T12:00:00.000Z',
          outflows: [{ asset: 'BTC', amount: '1.0' }],
        }),
        // Blockchain
        createTransaction({
          id: 2,
          source: 'bitcoin',
          datetime: '2024-01-01T13:00:00.000Z',
          inflows: [{ asset: 'BTC', amount: '1.0' }],
        }),
        // Exchange 2
        createTransaction({
          id: 3,
          source: 'coinbase',
          datetime: '2024-01-01T14:00:00.000Z',
          inflows: [{ asset: 'BTC', amount: '0.5' }],
        }),
      ];

      const links: TransactionLink[] = [
        // Exchange → Blockchain
        createTransactionLink({
          id: 'link-1',
          sourceTransactionId: 1,
          targetTransactionId: 2,
          linkType: 'exchange_to_blockchain',
          status: 'confirmed',
        }),
        // Blockchain → Exchange (unusual but valid)
        createTransactionLink({
          id: 'link-2',
          sourceTransactionId: 2,
          targetTransactionId: 3,
          linkType: 'exchange_to_blockchain',
          status: 'confirmed',
        }),
      ];

      const groups = builder.buildLinkGraph(transactions, links);

      // All transactions should be in one group
      expect(groups).toHaveLength(1);

      const group = groups[0]!;
      expect(group.transactions).toHaveLength(3);
      expect(group.sources).toEqual(new Set(['kraken', 'bitcoin', 'coinbase']));
      expect(group.linkChain).toHaveLength(2);
    });
  });
});
