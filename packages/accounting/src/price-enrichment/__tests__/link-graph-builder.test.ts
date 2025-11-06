import { parseDecimal, type UniversalTransaction } from '@exitbook/core';
import { describe, expect, it } from 'vitest';

import type { TransactionLink } from '../../linking/types.js';
import { buildLinkGraph } from '../link-graph-utils.js';

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
      inflows: params.inflows
        ? params.inflows.map((m) => ({ asset: m.asset, grossAmount: parseDecimal(m.amount) }))
        : [],
      outflows: params.outflows
        ? params.outflows.map((m) => ({ asset: m.asset, grossAmount: parseDecimal(m.amount) }))
        : [],
    },
    fees: [],
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
  asset?: string;
  confidenceScore?: string;
  id: string;
  linkType: 'exchange_to_blockchain' | 'blockchain_to_blockchain' | 'exchange_to_exchange';
  sourceAmount?: string;
  sourceTransactionId: number;
  status: 'suggested' | 'confirmed' | 'rejected';
  targetAmount?: string;
  targetTransactionId: number;
}): TransactionLink {
  return {
    id: params.id,
    sourceTransactionId: params.sourceTransactionId,
    targetTransactionId: params.targetTransactionId,
    asset: params.asset ?? 'BTC',
    sourceAmount: parseDecimal(params.sourceAmount ?? '1.0'),
    targetAmount: parseDecimal(params.targetAmount ?? '1.0'),
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
      const groups = buildLinkGraph([], []);

      expect(groups).toEqual([]);
    });

    it('should create single-transaction groups when no links exist (different sources)', () => {
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

      const groups = buildLinkGraph(transactions, []);

      // Each transaction should be in its own group (different sources)
      expect(groups).toHaveLength(3);

      for (const group of groups) {
        expect(group.transactions).toHaveLength(1);
        expect(group.sources.size).toBe(1);
        expect(group.linkChain).toHaveLength(0);
        expect(group.groupId).toBeTruthy(); // Has a UUID
      }
    });

    it('should group same-source transactions together even without links (Phase 1 backward compatibility)', () => {
      const transactions: UniversalTransaction[] = [
        // Kraken trade (buy BTC)
        createTransaction({
          id: 1,
          source: 'kraken',
          datetime: '2024-01-01T12:00:00.000Z',
          inflows: [{ asset: 'BTC', amount: '1.0' }],
          outflows: [{ asset: 'USD', amount: '50000' }],
        }),
        // Kraken withdrawal (no link to blockchain yet)
        createTransaction({
          id: 2,
          source: 'kraken',
          datetime: '2024-01-01T13:00:00.000Z',
          outflows: [{ asset: 'BTC', amount: '1.0' }],
        }),
        // Another Kraken transaction (internal transfer)
        createTransaction({
          id: 3,
          source: 'kraken',
          datetime: '2024-01-01T14:00:00.000Z',
          inflows: [{ asset: 'ETH', amount: '10.0' }],
        }),
      ];

      const groups = buildLinkGraph(transactions, []);

      // All Kraken transactions should be in ONE group (same source)
      // This preserves Phase 1 behavior where prices propagate within exchange
      expect(groups).toHaveLength(1);

      const group = groups[0]!;
      expect(group.transactions).toHaveLength(3);
      expect(group.sources).toEqual(new Set(['kraken']));
      expect(group.linkChain).toHaveLength(0); // No explicit links
      expect(group.groupId).toBeTruthy();
    });

    it('should NOT group blockchain transactions from same chain (prevents price leakage across wallets)', () => {
      const transactions: UniversalTransaction[] = [
        // Bitcoin wallet A
        createTransaction({
          id: 1,
          source: 'bitcoin',
          datetime: '2024-01-01T12:00:00.000Z',
          inflows: [{ asset: 'BTC', amount: '1.0' }],
        }),
        createTransaction({
          id: 2,
          source: 'bitcoin',
          datetime: '2024-01-01T13:00:00.000Z',
          outflows: [{ asset: 'BTC', amount: '0.5' }],
        }),
        // Bitcoin wallet B (completely separate, unrelated user/wallet)
        createTransaction({
          id: 3,
          source: 'bitcoin',
          datetime: '2024-01-01T14:00:00.000Z',
          inflows: [{ asset: 'BTC', amount: '2.0' }],
        }),
        createTransaction({
          id: 4,
          source: 'bitcoin',
          datetime: '2024-01-01T15:00:00.000Z',
          outflows: [{ asset: 'BTC', amount: '1.0' }],
        }),
      ];

      const groups = buildLinkGraph(transactions, []);

      // Each bitcoin transaction should be isolated (different wallets)
      // This prevents price leakage from wallet A to wallet B
      expect(groups).toHaveLength(4);

      for (const group of groups) {
        expect(group.transactions).toHaveLength(1);
        expect(group.sources).toEqual(new Set(['bitcoin']));
        expect(group.linkChain).toHaveLength(0);
      }
    });

    it('HIGH SEVERITY: should prevent price leakage from linked wallet to unrelated wallet on same chain', () => {
      const transactions: UniversalTransaction[] = [
        // Kraken withdrawal (has price)
        createTransaction({
          id: 1,
          source: 'kraken',
          datetime: '2024-01-01T12:00:00.000Z',
          outflows: [{ asset: 'BTC', amount: '1.0' }],
        }),
        // Bitcoin wallet A - receives Kraken withdrawal (linked)
        createTransaction({
          id: 2,
          source: 'bitcoin',
          datetime: '2024-01-01T13:00:00.000Z',
          inflows: [{ asset: 'BTC', amount: '1.0' }],
        }),
        // Bitcoin wallet B - completely UNRELATED wallet (must NOT get Kraken's price)
        createTransaction({
          id: 3,
          source: 'bitcoin',
          datetime: '2024-01-01T14:00:00.000Z',
          inflows: [{ asset: 'BTC', amount: '5.0' }],
        }),
        createTransaction({
          id: 4,
          source: 'bitcoin',
          datetime: '2024-01-01T15:00:00.000Z',
          outflows: [{ asset: 'BTC', amount: '2.0' }],
        }),
      ];

      const links: TransactionLink[] = [
        createTransactionLink({
          id: 'link-1',
          sourceTransactionId: 1, // Kraken withdrawal
          targetTransactionId: 2, // Bitcoin wallet A
          linkType: 'exchange_to_blockchain',
          status: 'confirmed',
        }),
      ];

      const groups = buildLinkGraph(transactions, links);

      // Should create 3 groups:
      // - Group 1: Kraken tx1 + Bitcoin tx2 (linked)
      // - Group 2: Bitcoin tx3 (isolated, wallet B)
      // - Group 3: Bitcoin tx4 (isolated, wallet B)
      expect(groups).toHaveLength(3);

      // Find the linked group
      const linkedGroup = groups.find((g) => g.linkChain.length > 0);
      expect(linkedGroup).toBeDefined();
      expect(linkedGroup!.transactions).toHaveLength(2);
      expect(linkedGroup!.transactions.map((t) => t.id).sort()).toEqual([1, 2]);

      // Verify wallet B transactions are isolated
      const isolatedGroups = groups.filter((g) => g.linkChain.length === 0);
      expect(isolatedGroups).toHaveLength(2);
      for (const group of isolatedGroups) {
        expect(group.transactions).toHaveLength(1);
        expect([3, 4]).toContain(group.transactions[0]!.id);
      }
    });

    it('should preserve same-exchange grouping while adding cross-platform links', () => {
      const transactions: UniversalTransaction[] = [
        // Kraken trade
        createTransaction({
          id: 1,
          source: 'kraken',
          datetime: '2024-01-01T12:00:00.000Z',
          inflows: [{ asset: 'BTC', amount: '1.0' }],
          outflows: [{ asset: 'USD', amount: '50000' }],
        }),
        // Kraken withdrawal (linked to blockchain)
        createTransaction({
          id: 2,
          source: 'kraken',
          datetime: '2024-01-01T13:00:00.000Z',
          outflows: [{ asset: 'BTC', amount: '1.0' }],
        }),
        // Bitcoin deposit (receives withdrawal)
        createTransaction({
          id: 3,
          source: 'bitcoin',
          datetime: '2024-01-01T14:00:00.000Z',
          inflows: [{ asset: 'BTC', amount: '1.0' }],
        }),
        // Bitcoin send (no link yet)
        createTransaction({
          id: 4,
          source: 'bitcoin',
          datetime: '2024-01-01T15:00:00.000Z',
          outflows: [{ asset: 'BTC', amount: '0.5' }],
        }),
      ];

      const links: TransactionLink[] = [
        createTransactionLink({
          id: 'link-1',
          sourceTransactionId: 2, // Kraken withdrawal
          targetTransactionId: 3, // Bitcoin deposit
          linkType: 'exchange_to_blockchain',
          status: 'confirmed',
        }),
      ];

      const groups = buildLinkGraph(transactions, links);

      // Should create TWO groups:
      // - Group 1: Kraken tx1, tx2 + Bitcoin tx3 (linked via tx2→tx3)
      //   - Kraken trade + withdrawal grouped by exchange
      //   - Bitcoin deposit linked to Kraken withdrawal
      // - Group 2: Bitcoin tx4 (isolated, different wallet from tx3)
      //   - NOT grouped with tx3 (blockchain transactions don't auto-group)
      expect(groups).toHaveLength(2);

      // Find the linked group with Kraken + Bitcoin
      const linkedGroup = groups.find((g) => g.sources.has('kraken'));
      expect(linkedGroup).toBeDefined();
      expect(linkedGroup!.transactions).toHaveLength(3);
      expect(linkedGroup!.transactions.map((t) => t.id).sort()).toEqual([1, 2, 3]);
      expect(linkedGroup!.sources).toEqual(new Set(['kraken', 'bitcoin']));
      expect(linkedGroup!.linkChain).toHaveLength(1);
      expect(linkedGroup!.linkChain[0]?.id).toBe('link-1');

      // Find the isolated Bitcoin transaction
      const isolatedGroup = groups.find((g) => !g.sources.has('kraken'));
      expect(isolatedGroup).toBeDefined();
      expect(isolatedGroup!.transactions).toHaveLength(1);
      expect(isolatedGroup!.transactions[0]!.id).toBe(4);
      expect(isolatedGroup!.linkChain).toHaveLength(0);
    });

    it('should group two transactions with a confirmed link', () => {
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

      const groups = buildLinkGraph(transactions, links);

      // Should create one group with both transactions
      expect(groups).toHaveLength(1);

      const group = groups[0]!;
      expect(group.transactions).toHaveLength(2);
      expect(group.sources).toEqual(new Set(['kraken', 'bitcoin']));
      expect(group.linkChain).toHaveLength(1);
      expect(group.linkChain[0]?.id).toBe('link-1');
    });

    it('should ignore suggested links (only use confirmed)', () => {
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

      const groups = buildLinkGraph(transactions, links);

      // Should create two separate groups since link is not confirmed
      expect(groups).toHaveLength(2);

      for (const group of groups) {
        expect(group.transactions).toHaveLength(1);
        expect(group.linkChain).toHaveLength(0);
      }
    });

    it('should ignore rejected links', () => {
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

      const groups = buildLinkGraph(transactions, links);

      // Should create two separate groups since link is rejected
      expect(groups).toHaveLength(2);

      for (const group of groups) {
        expect(group.transactions).toHaveLength(1);
        expect(group.linkChain).toHaveLength(0);
      }
    });

    it('should handle multi-hop links (transitive grouping)', () => {
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

      const groups = buildLinkGraph(transactions, links);

      // All four transactions should be in one group (transitive linking)
      expect(groups).toHaveLength(1);

      const group = groups[0]!;
      expect(group.transactions).toHaveLength(4);
      expect(group.sources).toEqual(new Set(['kraken', 'bitcoin', 'ethereum']));
      expect(group.linkChain).toHaveLength(3);
    });

    it('should handle circular links (naturally via Union-Find)', () => {
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

      const groups = buildLinkGraph(transactions, links);

      // Should still group all transactions together (circular link doesn't break Union-Find)
      expect(groups).toHaveLength(1);

      const group = groups[0]!;
      expect(group.transactions).toHaveLength(3);
      expect(group.linkChain).toHaveLength(3);
    });

    it('should create separate groups for disconnected link chains', () => {
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
        // Unlinked transaction (different source to stay isolated)
        createTransaction({
          id: 5,
          source: 'solana',
          datetime: '2024-01-01T16:00:00.000Z',
          outflows: [{ asset: 'SOL', amount: '100' }],
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

      const groups = buildLinkGraph(transactions, links);

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

      const groups = buildLinkGraph(transactions, links);

      // Should create 1 group with the two valid transactions
      expect(groups).toHaveLength(1);

      const group = groups[0]!;
      expect(group.transactions).toHaveLength(2);
      expect(group.linkChain).toHaveLength(1); // Only the valid link
      expect(group.linkChain[0]?.id).toBe('link-1');
    });

    it('should handle mixed link types in same group', () => {
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

      const groups = buildLinkGraph(transactions, links);

      // All transactions should be in one group
      expect(groups).toHaveLength(1);

      const group = groups[0]!;
      expect(group.transactions).toHaveLength(3);
      expect(group.sources).toEqual(new Set(['kraken', 'bitcoin', 'coinbase']));
      expect(group.linkChain).toHaveLength(2);
    });
  });
});
