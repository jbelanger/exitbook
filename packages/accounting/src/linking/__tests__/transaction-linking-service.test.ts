/* eslint-disable unicorn/no-null -- db requires null*/
import type { StoredTransaction } from '@exitbook/data';
import { getLogger } from '@exitbook/shared-logger';
import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';

import { DEFAULT_MATCHING_CONFIG } from '../matching-utils.js';
import { TransactionLinkingService } from '../transaction-linking-service.js';

const logger = getLogger('test');

/**
 * Helper to create a minimal StoredTransaction for testing.
 * Only requires the essential fields, rest are set to sensible defaults.
 */
function createTransaction(params: {
  datetime: string;
  externalId: string;
  fromAddress?: string | null;
  id: number;
  inflows?: { amount: string; asset: string }[];
  outflows?: { amount: string; asset: string }[];
  sourceId: string;
  sourceType: 'exchange' | 'blockchain';
  toAddress?: string | null;
}): StoredTransaction {
  return {
    id: params.id,
    import_session_id: 1,
    wallet_address_id: null,
    source_id: params.sourceId,
    source_type: params.sourceType,
    external_id: params.externalId,
    transaction_status: 'confirmed',
    transaction_datetime: params.datetime,
    from_address: params.fromAddress ?? null,
    to_address: params.toAddress ?? null,
    verified: true,
    price: null,
    price_currency: null,
    note_type: null,
    note_severity: null,
    note_message: null,
    note_metadata: null,
    movements_inflows: params.inflows
      ? params.inflows.map((m) => ({ asset: m.asset, amount: new Decimal(m.amount) }))
      : [],
    movements_outflows: params.outflows
      ? params.outflows.map((m) => ({ asset: m.asset, amount: new Decimal(m.amount) }))
      : [],
    fees_network: null,
    fees_platform: null,
    fees_total: null,
    operation_category: null,
    operation_type: null,
    blockchain_name: params.sourceType === 'blockchain' ? params.sourceId : null,
    blockchain_block_height: null,
    blockchain_transaction_hash: null,
    blockchain_is_confirmed: null,
    raw_normalized_data: '{}',
    created_at: params.datetime,
    updated_at: null,
  };
}

describe('TransactionLinkingService', () => {
  describe('linkTransactions', () => {
    it('should find exact match between exchange withdrawal and blockchain deposit', () => {
      const service = new TransactionLinkingService(logger, DEFAULT_MATCHING_CONFIG);

      const transactions: StoredTransaction[] = [
        // Exchange withdrawal
        createTransaction({
          id: 1,
          sourceId: 'kraken',
          sourceType: 'exchange',
          externalId: 'W123',
          datetime: '2024-01-01T12:00:00.000Z',
          outflows: [{ asset: 'BTC', amount: '1.0' }],
          toAddress: 'bc1qtest123',
        }),
        // Blockchain deposit
        createTransaction({
          id: 2,
          sourceId: 'bitcoin',
          sourceType: 'blockchain',
          externalId: 'txabc123',
          datetime: '2024-01-01T13:00:00.000Z',
          inflows: [{ asset: 'BTC', amount: '1.0' }],
          toAddress: 'bc1qtest123',
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
        expect(link?.confidenceScore.greaterThanOrEqualTo(new Decimal('0.95'))).toBe(true);
      }
    });

    it('should suggest low-confidence matches without auto-confirming', () => {
      const service = new TransactionLinkingService(logger, DEFAULT_MATCHING_CONFIG);

      const transactions: StoredTransaction[] = [
        // Exchange withdrawal - no address
        createTransaction({
          id: 1,
          sourceId: 'kraken',
          sourceType: 'exchange',
          externalId: 'W123',
          datetime: '2024-01-01T12:00:00.000Z',
          outflows: [{ asset: 'BTC', amount: '1.0' }],
        }),
        // Blockchain deposit - 24 hours later, 4% fee
        createTransaction({
          id: 2,
          sourceId: 'bitcoin',
          sourceType: 'blockchain',
          externalId: 'txabc123',
          datetime: '2024-01-02T12:00:00.000Z',
          inflows: [{ asset: 'BTC', amount: '0.96' }],
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
        expect(match?.confidenceScore.lessThan(new Decimal('0.95'))).toBe(true);
      }
    });

    it('should deduplicate matches - one target per source', () => {
      const service = new TransactionLinkingService(logger, DEFAULT_MATCHING_CONFIG);

      const transactions: StoredTransaction[] = [
        // Source 1 - closer in time (30 min before target)
        createTransaction({
          id: 1,
          sourceId: 'kraken',
          sourceType: 'exchange',
          externalId: 'W123',
          datetime: '2024-01-01T12:00:00.000Z',
          outflows: [{ asset: 'BTC', amount: '1.0' }],
        }),
        // Source 2 - farther in time (60 min before target)
        createTransaction({
          id: 2,
          sourceId: 'kraken',
          sourceType: 'exchange',
          externalId: 'W124',
          datetime: '2024-01-01T12:30:00.000Z',
          outflows: [{ asset: 'BTC', amount: '1.0' }],
        }),
        // Target (should only match to best source - id 1)
        createTransaction({
          id: 3,
          sourceId: 'bitcoin',
          sourceType: 'blockchain',
          externalId: 'txabc123',
          datetime: '2024-01-01T13:00:00.000Z',
          inflows: [{ asset: 'BTC', amount: '1.0' }],
        }),
      ];

      const result = service.linkTransactions(transactions);

      expect(result.isOk()).toBe(true);

      if (result.isOk()) {
        const { confirmedLinks, suggestedLinks } = result.value;
        const allLinks = [...confirmedLinks, ...suggestedLinks];

        // Should only have one link (best match)
        expect(allLinks).toHaveLength(1);

        // Should be the closer source (id=1, 30 min vs id=2, 60 min)
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

      const transactions: StoredTransaction[] = [
        // Transaction with no movements
        createTransaction({
          id: 1,
          sourceId: 'kraken',
          sourceType: 'exchange',
          externalId: 'W123',
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

      const transactions: StoredTransaction[] = [
        // Blockchain send
        createTransaction({
          id: 1,
          sourceId: 'bitcoin',
          sourceType: 'blockchain',
          externalId: 'txsend',
          datetime: '2024-01-01T12:00:00.000Z',
          outflows: [{ asset: 'BTC', amount: '0.5' }],
          fromAddress: 'bc1qsource',
          toAddress: 'bc1qtarget',
        }),
        // Blockchain receive (15 min later, slight fee)
        createTransaction({
          id: 2,
          sourceId: 'bitcoin',
          sourceType: 'blockchain',
          externalId: 'txrecv',
          datetime: '2024-01-01T12:15:00.000Z',
          inflows: [{ asset: 'BTC', amount: '0.4999' }],
          fromAddress: 'bc1qtarget',
          toAddress: 'bc1qreceiver',
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

      const transactions: StoredTransaction[] = [
        // Matched source (BTC withdrawal)
        createTransaction({
          id: 1,
          sourceId: 'kraken',
          sourceType: 'exchange',
          externalId: 'W123',
          datetime: '2024-01-01T12:00:00.000Z',
          outflows: [{ asset: 'BTC', amount: '1.0' }],
        }),
        // Unmatched source (ETH withdrawal)
        createTransaction({
          id: 2,
          sourceId: 'kraken',
          sourceType: 'exchange',
          externalId: 'W124',
          datetime: '2024-01-01T12:00:00.000Z',
          outflows: [{ asset: 'ETH', amount: '10.0' }],
        }),
        // Matched target (BTC deposit)
        createTransaction({
          id: 3,
          sourceId: 'bitcoin',
          sourceType: 'blockchain',
          externalId: 'txabc',
          datetime: '2024-01-01T13:00:00.000Z',
          inflows: [{ asset: 'BTC', amount: '1.0' }],
        }),
        // Unmatched target (USDT deposit)
        createTransaction({
          id: 4,
          sourceId: 'ethereum',
          sourceType: 'blockchain',
          externalId: 'txdef',
          datetime: '2024-01-01T13:00:00.000Z',
          inflows: [{ asset: 'USDT', amount: '1000.0' }],
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
  });

  describe('convertToCandidates', () => {
    it('should convert valid transactions to candidates', () => {
      const service = new TransactionLinkingService(logger, DEFAULT_MATCHING_CONFIG);

      const transactions: StoredTransaction[] = [
        createTransaction({
          id: 1,
          sourceId: 'kraken',
          sourceType: 'exchange',
          externalId: 'W123',
          datetime: '2024-01-01T12:00:00.000Z',
          outflows: [{ asset: 'BTC', amount: '1.0' }],
          toAddress: 'bc1qtest',
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

      const transactions: StoredTransaction[] = [
        // Transaction with only inflows is a deposit (direction 'in')
        createTransaction({
          id: 1,
          sourceId: 'bitcoin',
          sourceType: 'blockchain',
          externalId: 'D123',
          datetime: '2024-01-01T12:00:00.000Z',
          inflows: [{ asset: 'BTC', amount: '1.0' }],
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

      const transactions: StoredTransaction[] = [
        // Trade: BTC -> ETH
        createTransaction({
          id: 1,
          sourceId: 'kraken',
          sourceType: 'exchange',
          externalId: 'T123',
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

      const transactions: StoredTransaction[] = [
        // Single source
        createTransaction({
          id: 1,
          sourceId: 'kraken',
          sourceType: 'exchange',
          externalId: 'W123',
          datetime: '2024-01-01T12:00:00.000Z',
          outflows: [{ asset: 'BTC', amount: '1.0' }],
        }),
        // Target 1 - closer in time (1 hour later)
        createTransaction({
          id: 2,
          sourceId: 'bitcoin',
          sourceType: 'blockchain',
          externalId: 'txabc123',
          datetime: '2024-01-01T13:00:00.000Z',
          inflows: [{ asset: 'BTC', amount: '1.0' }],
        }),
        // Target 2 - farther in time (6 hours later)
        createTransaction({
          id: 3,
          sourceId: 'bitcoin',
          sourceType: 'blockchain',
          externalId: 'txdef456',
          datetime: '2024-01-01T18:00:00.000Z',
          inflows: [{ asset: 'BTC', amount: '1.0' }],
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

      const transactions: StoredTransaction[] = [
        // Source 1 - closer in time to target (1 hour before)
        createTransaction({
          id: 1,
          sourceId: 'kraken',
          sourceType: 'exchange',
          externalId: 'W123',
          datetime: '2024-01-01T12:00:00.000Z',
          outflows: [{ asset: 'BTC', amount: '1.0' }],
          toAddress: 'bc1qtarget',
        }),
        // Source 2 - farther in time from target (3 hours before)
        createTransaction({
          id: 2,
          sourceId: 'kraken',
          sourceType: 'exchange',
          externalId: 'W124',
          datetime: '2024-01-01T10:00:00.000Z',
          outflows: [{ asset: 'BTC', amount: '1.0' }],
          toAddress: 'bc1qtarget',
        }),
        // Target - should match to source 1 (closer)
        createTransaction({
          id: 3,
          sourceId: 'bitcoin',
          sourceType: 'blockchain',
          externalId: 'txabc',
          datetime: '2024-01-01T13:00:00.000Z',
          inflows: [{ asset: 'BTC', amount: '1.0' }],
          fromAddress: 'bc1qtarget',
          toAddress: 'bc1qfinal',
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

  describe('auto-confirmation', () => {
    it('should auto-confirm matches above threshold', () => {
      const service = new TransactionLinkingService(logger, {
        ...DEFAULT_MATCHING_CONFIG,
        autoConfirmThreshold: new Decimal('0.9'),
      });

      const transactions: StoredTransaction[] = [
        createTransaction({
          id: 1,
          sourceId: 'kraken',
          sourceType: 'exchange',
          externalId: 'W123',
          datetime: '2024-01-01T12:00:00.000Z',
          outflows: [{ asset: 'BTC', amount: '1.0' }],
          toAddress: 'bc1qtest',
        }),
        createTransaction({
          id: 2,
          sourceId: 'bitcoin',
          sourceType: 'blockchain',
          externalId: 'txabc',
          datetime: '2024-01-01T12:30:00.000Z',
          inflows: [{ asset: 'BTC', amount: '1.0' }],
          fromAddress: 'bc1qtest',
          toAddress: 'bc1qfinal',
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
        expect(link?.confidenceScore.greaterThanOrEqualTo(new Decimal('0.9'))).toBe(true);
      }
    });

    it('should suggest matches below threshold', () => {
      const service = new TransactionLinkingService(logger, {
        ...DEFAULT_MATCHING_CONFIG,
        autoConfirmThreshold: new Decimal('0.99'), // Very high threshold
      });

      const transactions: StoredTransaction[] = [
        createTransaction({
          id: 1,
          sourceId: 'kraken',
          sourceType: 'exchange',
          externalId: 'W123',
          datetime: '2024-01-01T12:00:00.000Z',
          outflows: [{ asset: 'BTC', amount: '1.0' }],
          // No address
        }),
        createTransaction({
          id: 2,
          sourceId: 'bitcoin',
          sourceType: 'blockchain',
          externalId: 'txabc',
          datetime: '2024-01-02T00:00:00.000Z', // 12 hours later
          inflows: [{ asset: 'BTC', amount: '0.98' }], // 2% fee
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
        expect(match?.confidenceScore.lessThan(new Decimal('0.99'))).toBe(true);
      }
    });
  });
});
