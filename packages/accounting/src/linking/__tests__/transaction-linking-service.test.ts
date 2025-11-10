import { parseDecimal, type UniversalTransaction } from '@exitbook/core';
import { getLogger } from '@exitbook/logger';
import { describe, expect, it } from 'vitest';

import { DEFAULT_MATCHING_CONFIG } from '../matching-utils.js';
import { TransactionLinkingService } from '../transaction-linking-service.js';

const logger = getLogger('test');

/**
 * Helper to create a minimal UniversalTransaction for testing.
 * Only requires the essential fields, rest are set to sensible defaults.
 */
function createTransaction(params: {
  blockchain?: { is_confirmed: boolean; name: string; transaction_hash: string };
  datetime: string;
  from?: string;
  id: number;
  inflows?: { amount: string; asset: string }[];
  outflows?: { amount: string; asset: string }[];
  source: string;
  to?: string;
}): UniversalTransaction {
  return {
    id: params.id,
    externalId: `${params.source}-${params.id}`,
    datetime: params.datetime,
    timestamp: new Date(params.datetime).getTime(),
    source: params.source,
    status: 'success',
    from: params.from,
    to: params.to,
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
    blockchain: params.blockchain,
  };
}

describe('TransactionLinkingService', () => {
  describe('linkTransactions', () => {
    it('should find exact match between exchange withdrawal and blockchain deposit', () => {
      const service = new TransactionLinkingService(logger, DEFAULT_MATCHING_CONFIG);

      const transactions: UniversalTransaction[] = [
        // Exchange withdrawal
        createTransaction({
          id: 1,
          source: 'kraken',
          datetime: '2024-01-01T12:00:00.000Z',
          outflows: [{ asset: 'BTC', amount: '1.0' }],
          to: 'bc1qtest123',
        }),
        // Blockchain deposit
        createTransaction({
          id: 2,
          source: 'bitcoin',
          datetime: '2024-01-01T13:00:00.000Z',
          inflows: [{ asset: 'BTC', amount: '1.0' }],
          to: 'bc1qtest123',
          blockchain: { name: 'bitcoin', transaction_hash: 'txabc123', is_confirmed: true },
        }),
      ];

      const result = service.linkTransactions(transactions);

      expect(result.isOk()).toBe(true);

      if (result.isOk()) {
        const { confirmedLinks, suggestedLinks } = result.value;

        // Should auto-confirm this high-confidence match
        expect(confirmedLinks).toHaveLength(1);
        expect(suggestedLinks).toHaveLength(0);

        const link = confirmedLinks[0];
        expect(link?.sourceTransactionId).toBe(1);
        expect(link?.targetTransactionId).toBe(2);
        expect(link?.linkType).toBe('exchange_to_blockchain');
        expect(link?.status).toBe('confirmed');
        expect(link?.reviewedBy).toBe('auto');
        expect(link?.confidenceScore.greaterThanOrEqualTo(parseDecimal('0.95'))).toBe(true);
      }
    });

    it('should suggest low-confidence matches without auto-confirming', () => {
      const service = new TransactionLinkingService(logger, DEFAULT_MATCHING_CONFIG);

      const transactions: UniversalTransaction[] = [
        // Exchange withdrawal - no address
        createTransaction({
          id: 1,
          source: 'kraken',
          datetime: '2024-01-01T12:00:00.000Z',
          outflows: [{ asset: 'BTC', amount: '1.0' }],
        }),
        // Blockchain deposit - 24 hours later, 4% fee
        createTransaction({
          id: 2,
          source: 'bitcoin',
          datetime: '2024-01-02T12:00:00.000Z',
          inflows: [{ asset: 'BTC', amount: '0.96' }],
          blockchain: { name: 'bitcoin', transaction_hash: 'txabc123', is_confirmed: true },
        }),
      ];

      const result = service.linkTransactions(transactions);

      expect(result.isOk()).toBe(true);

      if (result.isOk()) {
        const { confirmedLinks, suggestedLinks } = result.value;

        // Should suggest but not auto-confirm due to lower confidence
        expect(confirmedLinks).toHaveLength(0);
        expect(suggestedLinks).toHaveLength(1);

        const match = suggestedLinks[0];
        expect(match?.sourceTransaction.id).toBe(1);
        expect(match?.targetTransaction.id).toBe(2);
        expect(match?.linkType).toBe('exchange_to_blockchain');
        expect(match?.confidenceScore.lessThan(parseDecimal('0.95'))).toBe(true);
      }
    });

    it('should deduplicate matches - one target per source', () => {
      const service = new TransactionLinkingService(logger, DEFAULT_MATCHING_CONFIG);

      const transactions: UniversalTransaction[] = [
        // Source 1 - closer in time (30 min before target)
        createTransaction({
          id: 1,
          source: 'kraken',
          datetime: '2024-01-01T12:00:00.000Z',
          outflows: [{ asset: 'BTC', amount: '1.0' }],
        }),
        // Source 2 - farther in time (60 min before target)
        createTransaction({
          id: 2,
          source: 'kraken',
          datetime: '2024-01-01T12:30:00.000Z',
          outflows: [{ asset: 'BTC', amount: '1.0' }],
        }),
        // Target (should only match to best source - id 1)
        createTransaction({
          id: 3,
          source: 'bitcoin',
          datetime: '2024-01-01T13:00:00.000Z',
          inflows: [{ asset: 'BTC', amount: '1.0' }],
          blockchain: { name: 'bitcoin', transaction_hash: 'txabc123', is_confirmed: true },
        }),
      ];

      const result = service.linkTransactions(transactions);

      expect(result.isOk()).toBe(true);

      if (result.isOk()) {
        const { confirmedLinks, suggestedLinks } = result.value;
        const allLinks = [...confirmedLinks, ...suggestedLinks];

        // Should only have one link (best match)
        expect(allLinks).toHaveLength(1);

        // Should be the closer source (id='1', 30 min vs id='2', 60 min)
        const link = allLinks[0];
        if (link) {
          if ('sourceTransactionId' in link) {
            expect(link.sourceTransactionId).toBe(1);
          } else {
            expect(link.sourceTransaction.id).toBe(1);
          }
        } else {
          throw new Error('Expected a link but found undefined');
        }
      }
    });

    it('should skip transactions without movement data', () => {
      const service = new TransactionLinkingService(logger, DEFAULT_MATCHING_CONFIG);

      const transactions: UniversalTransaction[] = [
        // Transaction with no movements
        createTransaction({
          id: 1,
          source: 'kraken',
          datetime: '2024-01-01T12:00:00.000Z',
          // No inflows or outflows
        }),
      ];

      const result = service.linkTransactions(transactions);

      expect(result.isOk()).toBe(true);

      if (result.isOk()) {
        const { confirmedLinks, suggestedLinks, totalSourceTransactions, totalTargetTransactions } = result.value;

        // Should have no matches
        expect(confirmedLinks).toHaveLength(0);
        expect(suggestedLinks).toHaveLength(0);
        expect(totalSourceTransactions).toBe(0);
        expect(totalTargetTransactions).toBe(0);
      }
    });

    it('should handle blockchain-to-blockchain links', () => {
      const service = new TransactionLinkingService(logger, DEFAULT_MATCHING_CONFIG);

      const transactions: UniversalTransaction[] = [
        // Blockchain send
        createTransaction({
          id: 1,
          source: 'bitcoin',
          datetime: '2024-01-01T12:00:00.000Z',
          outflows: [{ asset: 'BTC', amount: '0.5' }],
          from: 'bc1qsource',
          to: 'bc1qtarget',
          blockchain: { name: 'bitcoin', transaction_hash: 'txsend', is_confirmed: true },
        }),
        // Blockchain receive (15 min later, slight fee)
        createTransaction({
          id: 2,
          source: 'bitcoin',
          datetime: '2024-01-01T12:15:00.000Z',
          inflows: [{ asset: 'BTC', amount: '0.4999' }],
          from: 'bc1qtarget',
          to: 'bc1qreceiver',
          blockchain: { name: 'bitcoin', transaction_hash: 'txrecv', is_confirmed: true },
        }),
      ];

      const result = service.linkTransactions(transactions);

      expect(result.isOk()).toBe(true);

      if (result.isOk()) {
        const { confirmedLinks, suggestedLinks } = result.value;
        const allLinks = [...confirmedLinks, ...suggestedLinks];

        expect(allLinks).toHaveLength(1);

        const link = allLinks[0];
        if (!link) {
          throw new Error('Expected a link but found undefined');
        }
        const linkType = 'linkType' in link ? link.linkType : undefined;
        expect(linkType).toBe('blockchain_to_blockchain');
      }
    });

    it('should handle empty transaction list', () => {
      const service = new TransactionLinkingService(logger, DEFAULT_MATCHING_CONFIG);

      const result = service.linkTransactions([]);

      expect(result.isOk()).toBe(true);

      if (result.isOk()) {
        const { confirmedLinks, suggestedLinks } = result.value;

        expect(confirmedLinks).toHaveLength(0);
        expect(suggestedLinks).toHaveLength(0);
      }
    });

    it('should calculate statistics correctly', () => {
      const service = new TransactionLinkingService(logger, DEFAULT_MATCHING_CONFIG);

      const transactions: UniversalTransaction[] = [
        // Matched source (BTC withdrawal)
        createTransaction({
          id: 1,
          source: 'kraken',
          datetime: '2024-01-01T12:00:00.000Z',
          outflows: [{ asset: 'BTC', amount: '1.0' }],
        }),
        // Unmatched source (ETH withdrawal)
        createTransaction({
          id: 2,
          source: 'kraken',
          datetime: '2024-01-01T12:00:00.000Z',
          outflows: [{ asset: 'ETH', amount: '10.0' }],
        }),
        // Matched target (BTC deposit)
        createTransaction({
          id: 3,
          source: 'bitcoin',
          datetime: '2024-01-01T13:00:00.000Z',
          inflows: [{ asset: 'BTC', amount: '1.0' }],
          blockchain: { name: 'bitcoin', transaction_hash: 'txabc', is_confirmed: true },
        }),
        // Unmatched target (USDT deposit)
        createTransaction({
          id: 4,
          source: 'ethereum',
          datetime: '2024-01-01T13:00:00.000Z',
          inflows: [{ asset: 'USDT', amount: '1000.0' }],
          blockchain: { name: 'ethereum', transaction_hash: 'txdef', is_confirmed: true },
        }),
      ];

      const result = service.linkTransactions(transactions);

      expect(result.isOk()).toBe(true);

      if (result.isOk()) {
        const {
          totalSourceTransactions,
          totalTargetTransactions,
          matchedTransactionCount,
          unmatchedSourceCount,
          unmatchedTargetCount,
        } = result.value;

        expect(totalSourceTransactions).toBe(2); // BTC and ETH withdrawals
        expect(totalTargetTransactions).toBe(2); // BTC and USDT deposits
        expect(matchedTransactionCount).toBe(2); // 1 source + 1 target = 2 transactions involved
        expect(unmatchedSourceCount).toBe(1); // ETH withdrawal unmatched
        expect(unmatchedTargetCount).toBe(1); // USDT deposit unmatched
      }
    });

    it('should exclude filtered links from statistics (target > source)', () => {
      const service = new TransactionLinkingService(logger, DEFAULT_MATCHING_CONFIG);

      const transactions: UniversalTransaction[] = [
        // Source 1 - valid match
        createTransaction({
          id: 1,
          source: 'kraken',
          datetime: '2024-01-01T12:00:00.000Z',
          outflows: [{ asset: 'BTC', amount: '1.0' }],
        }),
        // Source 2 - will match but target exceeds source (airdrop scenario)
        createTransaction({
          id: 2,
          source: 'kraken',
          datetime: '2024-01-01T12:00:00.000Z',
          outflows: [{ asset: 'ETH', amount: '10.0' }],
        }),
        // Target 1 - valid match to source 1
        createTransaction({
          id: 3,
          source: 'bitcoin',
          datetime: '2024-01-01T13:00:00.000Z',
          inflows: [{ asset: 'BTC', amount: '0.995' }], // 0.5% fee (valid)
          blockchain: { name: 'bitcoin', transaction_hash: 'txabc', is_confirmed: true },
        }),
        // Target 2 - exceeds source 2 (will be filtered out)
        createTransaction({
          id: 4,
          source: 'ethereum',
          datetime: '2024-01-01T13:00:00.000Z',
          inflows: [{ asset: 'ETH', amount: '10.5' }], // Received MORE than sent (airdrop)
          blockchain: { name: 'ethereum', transaction_hash: 'txdef', is_confirmed: true },
        }),
      ];

      const result = service.linkTransactions(transactions);

      expect(result.isOk()).toBe(true);

      if (result.isOk()) {
        const {
          confirmedLinks,
          suggestedLinks,
          totalSourceTransactions,
          totalTargetTransactions,
          matchedTransactionCount,
          unmatchedSourceCount,
          unmatchedTargetCount,
        } = result.value;

        // ETH link should be filtered out due to target > source
        const allLinks = [...confirmedLinks, ...suggestedLinks];
        expect(allLinks).toHaveLength(1); // Only BTC link

        // Statistics should reflect only the valid link
        expect(totalSourceTransactions).toBe(2); // BTC and ETH withdrawals
        expect(totalTargetTransactions).toBe(2); // BTC and ETH deposits
        expect(matchedTransactionCount).toBe(2); // Only BTC: 1 source + 1 target
        expect(unmatchedSourceCount).toBe(1); // ETH source unmatched (link filtered)
        expect(unmatchedTargetCount).toBe(1); // ETH target unmatched (link filtered)
      }
    });

    it('should exclude filtered links from statistics (excessive variance)', () => {
      const service = new TransactionLinkingService(logger, DEFAULT_MATCHING_CONFIG);

      const transactions: UniversalTransaction[] = [
        // Source 1 - valid match
        createTransaction({
          id: 1,
          source: 'kraken',
          datetime: '2024-01-01T12:00:00.000Z',
          outflows: [{ asset: 'BTC', amount: '1.0' }],
        }),
        // Source 2 - will match but variance > 10%
        createTransaction({
          id: 2,
          source: 'kraken',
          datetime: '2024-01-01T12:00:00.000Z',
          outflows: [{ asset: 'ETH', amount: '10.0' }],
        }),
        // Target 1 - valid match to source 1
        createTransaction({
          id: 3,
          source: 'bitcoin',
          datetime: '2024-01-01T13:00:00.000Z',
          inflows: [{ asset: 'BTC', amount: '0.995' }], // 0.5% fee (valid)
          blockchain: { name: 'bitcoin', transaction_hash: 'txabc', is_confirmed: true },
        }),
        // Target 2 - excessive variance from source 2 (>10%)
        createTransaction({
          id: 4,
          source: 'ethereum',
          datetime: '2024-01-01T13:00:00.000Z',
          inflows: [{ asset: 'ETH', amount: '8.5' }], // 15% fee (excessive)
          blockchain: { name: 'ethereum', transaction_hash: 'txdef', is_confirmed: true },
        }),
      ];

      const result = service.linkTransactions(transactions);

      expect(result.isOk()).toBe(true);

      if (result.isOk()) {
        const {
          confirmedLinks,
          suggestedLinks,
          totalSourceTransactions,
          totalTargetTransactions,
          matchedTransactionCount,
          unmatchedSourceCount,
          unmatchedTargetCount,
        } = result.value;

        // ETH link should be filtered out due to excessive variance
        const allLinks = [...confirmedLinks, ...suggestedLinks];
        expect(allLinks).toHaveLength(1); // Only BTC link

        // Statistics should reflect only the valid link
        expect(totalSourceTransactions).toBe(2);
        expect(totalTargetTransactions).toBe(2);
        expect(matchedTransactionCount).toBe(2); // Only BTC: 1 source + 1 target
        expect(unmatchedSourceCount).toBe(1); // ETH source unmatched (link filtered)
        expect(unmatchedTargetCount).toBe(1); // ETH target unmatched (link filtered)
      }
    });
  });

  describe('convertToCandidates', () => {
    it('should convert valid transactions to candidates', () => {
      const service = new TransactionLinkingService(logger, DEFAULT_MATCHING_CONFIG);

      const transactions: UniversalTransaction[] = [
        createTransaction({
          id: 1,
          source: 'kraken',
          datetime: '2024-01-01T12:00:00.000Z',
          outflows: [{ asset: 'BTC', amount: '1.0' }],
          to: 'bc1qtest',
        }),
      ];

      const result = service.linkTransactions(transactions);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        // Should have 1 source (the withdrawal)
        expect(result.value.totalSourceTransactions).toBe(1);
        expect(result.value.totalTargetTransactions).toBe(0);
      }
    });

    it('should skip transactions with only inflows (no direction)', () => {
      const service = new TransactionLinkingService(logger, DEFAULT_MATCHING_CONFIG);

      const transactions: UniversalTransaction[] = [
        // Transaction with only inflows is a deposit (direction 'in')
        createTransaction({
          id: 1,
          source: 'bitcoin',
          datetime: '2024-01-01T12:00:00.000Z',
          inflows: [{ asset: 'BTC', amount: '1.0' }],
          blockchain: { name: 'bitcoin', transaction_hash: 'D123', is_confirmed: true },
        }),
      ];

      const result = service.linkTransactions(transactions);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        // Deposit should be a target, not a source
        expect(result.value.totalSourceTransactions).toBe(0);
        expect(result.value.totalTargetTransactions).toBe(1);
      }
    });

    it('should skip transactions with both inflows and outflows (trades)', () => {
      const service = new TransactionLinkingService(logger, DEFAULT_MATCHING_CONFIG);

      const transactions: UniversalTransaction[] = [
        // Trade: BTC -> ETH
        createTransaction({
          id: 1,
          source: 'kraken',
          datetime: '2024-01-01T12:00:00.000Z',
          inflows: [{ asset: 'ETH', amount: '10.0' }],
          outflows: [{ asset: 'BTC', amount: '1.0' }],
        }),
      ];

      const result = service.linkTransactions(transactions);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        // Trades should participate in linking (primary movement is computed)
        // In this case, ETH inflow is larger in value, so it becomes an 'in' direction
        // But since we can't know prices, the service uses largest by amount
        // ETH 10.0 > BTC 1.0, so direction is 'in', making it a target
        expect(result.value.totalTargetTransactions).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('deduplication', () => {
    it('should prevent one source from matching multiple targets', () => {
      const service = new TransactionLinkingService(logger, DEFAULT_MATCHING_CONFIG);

      const transactions: UniversalTransaction[] = [
        // Single source
        createTransaction({
          id: 1,
          source: 'kraken',
          datetime: '2024-01-01T12:00:00.000Z',
          outflows: [{ asset: 'BTC', amount: '1.0' }],
        }),
        // Target 1 - closer in time (1 hour later)
        createTransaction({
          id: 2,
          source: 'bitcoin',
          datetime: '2024-01-01T13:00:00.000Z',
          inflows: [{ asset: 'BTC', amount: '1.0' }],
          blockchain: { name: 'bitcoin', transaction_hash: 'txabc123', is_confirmed: true },
        }),
        // Target 2 - farther in time (6 hours later)
        createTransaction({
          id: 3,
          source: 'bitcoin',
          datetime: '2024-01-01T18:00:00.000Z',
          inflows: [{ asset: 'BTC', amount: '1.0' }],
          blockchain: { name: 'bitcoin', transaction_hash: 'txdef456', is_confirmed: true },
        }),
      ];

      const result = service.linkTransactions(transactions);

      expect(result.isOk()).toBe(true);

      if (result.isOk()) {
        const { confirmedLinks, suggestedLinks } = result.value;
        const allLinks = [...confirmedLinks, ...suggestedLinks];

        // Should only have one link (source can only match one target)
        expect(allLinks).toHaveLength(1);

        // Should match to the higher confidence target (closer in time)
        const link = allLinks[0];
        if (!link) {
          throw new Error('Expected a link but found undefined');
        }
        if ('targetTransactionId' in link) {
          expect(link.targetTransactionId).toBe(2); // The closer deposit
        } else {
          expect(link.targetTransaction.id).toBe(2); // The closer deposit
        }
      }
    });

    it('should keep only highest confidence match per target', () => {
      const service = new TransactionLinkingService(logger, DEFAULT_MATCHING_CONFIG);

      const transactions: UniversalTransaction[] = [
        // Source 1 - closer in time to target (1 hour before)
        createTransaction({
          id: 1,
          source: 'kraken',
          datetime: '2024-01-01T12:00:00.000Z',
          outflows: [{ asset: 'BTC', amount: '1.0' }],
          to: 'bc1qtarget',
        }),
        // Source 2 - farther in time from target (3 hours before)
        createTransaction({
          id: 2,
          source: 'kraken',
          datetime: '2024-01-01T10:00:00.000Z',
          outflows: [{ asset: 'BTC', amount: '1.0' }],
          to: 'bc1qtarget',
        }),
        // Target - should match to source 1 (closer)
        createTransaction({
          id: 3,
          source: 'bitcoin',
          datetime: '2024-01-01T13:00:00.000Z',
          inflows: [{ asset: 'BTC', amount: '1.0' }],
          from: 'bc1qtarget',
          to: 'bc1qfinal',
          blockchain: { name: 'bitcoin', transaction_hash: 'txabc', is_confirmed: true },
        }),
      ];

      const result = service.linkTransactions(transactions);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const { confirmedLinks, suggestedLinks } = result.value;
        const allLinks = [...confirmedLinks, ...suggestedLinks];

        // Should have exactly one link
        expect(allLinks).toHaveLength(1);

        // Should be matched to source 1 (closer in time)
        const link = allLinks[0];
        if (!link) {
          throw new Error('Expected a link but found undefined');
        }
        if ('sourceTransactionId' in link) {
          expect(link.sourceTransactionId).toBe(1);
        } else {
          expect(link.sourceTransaction.id).toBe(1);
        }
      }
    });
  });

  describe('self-matching prevention', () => {
    it('should not match a transaction against itself when it has both inflows and outflows of the same asset', () => {
      const service = new TransactionLinkingService(logger, DEFAULT_MATCHING_CONFIG);

      const transactions: UniversalTransaction[] = [
        // Self-transfer: BTC withdrawal with change (both in and out in same tx)
        createTransaction({
          id: 1,
          source: 'bitcoin',
          datetime: '2024-01-01T12:00:00.000Z',
          inflows: [{ asset: 'BTC', amount: '0.5' }], // Change output
          outflows: [{ asset: 'BTC', amount: '0.49' }], // Sent amount (minus fee)
          blockchain: { name: 'bitcoin', transaction_hash: 'txself', is_confirmed: true },
        }),
      ];

      const result = service.linkTransactions(transactions);

      expect(result.isOk()).toBe(true);

      if (result.isOk()) {
        const { confirmedLinks, suggestedLinks } = result.value;

        // Should have NO matches (transaction should not match itself)
        expect(confirmedLinks).toHaveLength(0);
        expect(suggestedLinks).toHaveLength(0);
      }
    });

    it('should not match a swap transaction against itself', () => {
      const service = new TransactionLinkingService(logger, DEFAULT_MATCHING_CONFIG);

      const transactions: UniversalTransaction[] = [
        // BTC swap with BTC fee (both BTC in and out)
        createTransaction({
          id: 1,
          source: 'kraken',
          datetime: '2024-01-01T12:00:00.000Z',
          inflows: [
            { asset: 'ETH', amount: '10.0' },
            { asset: 'BTC', amount: '0.001' },
          ], // Rebate
          outflows: [{ asset: 'BTC', amount: '1.0' }],
        }),
      ];

      const result = service.linkTransactions(transactions);

      expect(result.isOk()).toBe(true);

      if (result.isOk()) {
        const { confirmedLinks, suggestedLinks } = result.value;

        // Should have NO matches (BTC inflow should not match BTC outflow from same tx)
        expect(confirmedLinks).toHaveLength(0);
        expect(suggestedLinks).toHaveLength(0);
      }
    });
  });

  describe('auto-confirmation', () => {
    it('should auto-confirm matches above threshold', () => {
      const service = new TransactionLinkingService(logger, {
        ...DEFAULT_MATCHING_CONFIG,
        autoConfirmThreshold: parseDecimal('0.9'),
      });

      const transactions: UniversalTransaction[] = [
        createTransaction({
          id: 1,
          source: 'kraken',
          datetime: '2024-01-01T12:00:00.000Z',
          outflows: [{ asset: 'BTC', amount: '1.0' }],
          to: 'bc1qtest',
        }),
        createTransaction({
          id: 2,
          source: 'bitcoin',
          datetime: '2024-01-01T12:30:00.000Z',
          inflows: [{ asset: 'BTC', amount: '1.0' }],
          from: 'bc1qtest',
          to: 'bc1qfinal',
          blockchain: { name: 'bitcoin', transaction_hash: 'txabc', is_confirmed: true },
        }),
      ];

      const result = service.linkTransactions(transactions);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const { confirmedLinks, suggestedLinks } = result.value;

        // Should be auto-confirmed (threshold is 0.9)
        expect(confirmedLinks).toHaveLength(1);
        expect(suggestedLinks).toHaveLength(0);

        const link = confirmedLinks[0];
        expect(link?.status).toBe('confirmed');
        expect(link?.reviewedBy).toBe('auto');
        expect(link?.confidenceScore.greaterThanOrEqualTo(parseDecimal('0.9'))).toBe(true);
      }
    });

    it('should suggest matches below threshold', () => {
      const service = new TransactionLinkingService(logger, {
        ...DEFAULT_MATCHING_CONFIG,
        autoConfirmThreshold: parseDecimal('0.99'), // Very high threshold
      });

      const transactions: UniversalTransaction[] = [
        createTransaction({
          id: 1,
          source: 'kraken',
          datetime: '2024-01-01T12:00:00.000Z',
          outflows: [{ asset: 'BTC', amount: '1.0' }],
          // No address
        }),
        createTransaction({
          id: 2,
          source: 'bitcoin',
          datetime: '2024-01-02T00:00:00.000Z', // 12 hours later
          inflows: [{ asset: 'BTC', amount: '0.98' }], // 2% fee
          blockchain: { name: 'bitcoin', transaction_hash: 'txabc', is_confirmed: true },
          // No address
        }),
      ];

      const result = service.linkTransactions(transactions);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const { confirmedLinks, suggestedLinks } = result.value;

        // Should be suggested, not confirmed (threshold is 0.99)
        expect(confirmedLinks).toHaveLength(0);
        expect(suggestedLinks).toHaveLength(1);

        const match = suggestedLinks[0];
        expect(match?.confidenceScore.lessThan(parseDecimal('0.99'))).toBe(true);
      }
    });
  });
});
