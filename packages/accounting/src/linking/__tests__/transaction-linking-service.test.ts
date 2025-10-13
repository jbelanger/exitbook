/* eslint-disable unicorn/no-null -- db requires null*/
import type { StoredTransaction } from '@exitbook/data';
import { getLogger } from '@exitbook/shared-logger';
import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';

import { DEFAULT_MATCHING_CONFIG } from '../matching-utils.js';
import { TransactionLinkingService } from '../transaction-linking-service.js';

const logger = getLogger('test');

describe('TransactionLinkingService', () => {
  describe('linkTransactions', () => {
    it('should find exact match between exchange withdrawal and blockchain deposit', () => {
      const service = new TransactionLinkingService(logger, DEFAULT_MATCHING_CONFIG);

      const transactions: StoredTransaction[] = [
        {
          id: 1,
          import_session_id: 1,
          wallet_address_id: null,
          source_id: 'kraken',
          source_type: 'exchange',
          external_id: 'W123',
          transaction_status: 'confirmed',
          transaction_datetime: '2024-01-01T12:00:00.000Z',
          from_address: null,
          to_address: 'bc1qtest123',
          verified: true,
          price: null,
          price_currency: null,
          note_type: null,
          note_severity: null,
          note_message: null,
          note_metadata: null,
          movements_primary_asset: 'BTC',
          movements_primary_amount: '1.0',
          movements_primary_direction: 'out',
          movements_secondary_asset: null,
          movements_secondary_amount: null,
          movements_secondary_direction: null,
          movements_fee_asset: null,
          movements_fee_amount: null,
          created_at: '2024-01-01T12:00:00.000Z',
        } as unknown as StoredTransaction,
        {
          id: 2,
          import_session_id: 2,
          wallet_address_id: null,
          source_id: 'bitcoin',
          source_type: 'blockchain',
          external_id: 'txabc123',
          transaction_status: 'confirmed',
          transaction_datetime: '2024-01-01T13:00:00.000Z',
          from_address: null,
          to_address: 'bc1qtest123',
          verified: true,
          price: null,
          price_currency: null,
          note_type: null,
          note_severity: null,
          note_message: null,
          note_metadata: null,
          movements_primary_asset: 'BTC',
          movements_primary_amount: '1.0',
          movements_primary_direction: 'in',
          movements_secondary_asset: null,
          movements_secondary_amount: null,
          movements_secondary_direction: null,
          movements_fee_asset: null,
          movements_fee_amount: null,
          created_at: '2024-01-01T13:00:00.000Z',
        } as unknown as StoredTransaction,
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
        {
          id: 1,
          import_session_id: 1,
          wallet_address_id: null,
          source_id: 'kraken',
          source_type: 'exchange',
          external_id: 'W123',
          transaction_status: 'confirmed',
          transaction_datetime: '2024-01-01T12:00:00.000Z',
          from_address: null,
          to_address: null,
          verified: true,
          price: null,
          price_currency: null,
          note_type: null,
          note_severity: null,
          note_message: null,
          note_metadata: null,
          movements_primary_asset: 'BTC',
          movements_primary_amount: '1.0',
          movements_primary_direction: 'out',
          movements_secondary_asset: null,
          movements_secondary_amount: null,
          movements_secondary_direction: null,
          movements_fee_asset: null,
          movements_fee_amount: null,
          created_at: '2024-01-01T12:00:00.000Z',
        } as unknown as StoredTransaction,
        {
          id: 2,
          import_session_id: 2,
          wallet_address_id: null,
          source_id: 'bitcoin',
          source_type: 'blockchain',
          external_id: 'txabc123',
          transaction_status: 'confirmed',
          transaction_datetime: '2024-01-02T12:00:00.000Z', // 24 hours later
          from_address: null,
          to_address: null,
          verified: true,
          price: null,
          price_currency: null,
          note_type: null,
          note_severity: null,
          note_message: null,
          note_metadata: null,
          movements_primary_asset: 'BTC',
          movements_primary_amount: '0.9', // 10% fee (lower amount)
          movements_primary_direction: 'in',
          movements_secondary_asset: null,
          movements_secondary_amount: null,
          movements_secondary_direction: null,
          movements_fee_asset: null,
          movements_fee_amount: null,
          created_at: '2024-01-02T12:00:00.000Z',
        } as unknown as StoredTransaction,
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
        // Source 1
        // Source 1
        {
          id: 1,
          import_session_id: 1,
          wallet_address_id: null,
          source_id: 'kraken',
          source_type: 'exchange',
          external_id: 'W123',
          transaction_status: 'confirmed',
          transaction_datetime: '2024-01-01T12:00:00.000Z',
          from_address: null,
          to_address: null,
          verified: true,
          price: null,
          price_currency: null,
          note_type: null,
          note_severity: null,
          note_message: null,
          note_metadata: null,
          movements_primary_asset: 'BTC',
          movements_primary_amount: '1.0',
          movements_primary_direction: 'out',
          movements_secondary_asset: null,
          movements_secondary_amount: null,
          movements_secondary_direction: null,
          movements_fee_asset: null,
          movements_fee_amount: null,
          created_at: '2024-01-01T12:00:00.000Z',
        } as unknown as StoredTransaction,
        // Source 2 (competing for same target)
        // Source 2 (competing for same target)
        {
          id: 2,
          import_session_id: 1,
          wallet_address_id: null,
          source_id: 'kraken',
          source_type: 'exchange',
          external_id: 'W124',
          transaction_status: 'confirmed',
          transaction_datetime: '2024-01-01T12:30:00.000Z',
          from_address: null,
          to_address: null,
          verified: true,
          price: null,
          price_currency: null,
          note_type: null,
          note_severity: null,
          note_message: null,
          note_metadata: null,
          movements_primary_asset: 'BTC',
          movements_primary_amount: '1.0',
          movements_primary_direction: 'out',
          movements_secondary_asset: null,
          movements_secondary_amount: null,
          movements_secondary_direction: null,
          movements_fee_asset: null,
          movements_fee_amount: null,
          created_at: '2024-01-01T12:30:00.000Z',
        } as unknown as StoredTransaction,
        // Target (should only match to best source)
        // Target (should only match to best source)
        {
          id: 3,
          import_session_id: 2,
          wallet_address_id: null,
          source_id: 'bitcoin',
          source_type: 'blockchain',
          external_id: 'txabc123',
          transaction_status: 'confirmed',
          transaction_datetime: '2024-01-01T13:00:00.000Z',
          from_address: null,
          to_address: null,
          verified: true,
          price: null,
          price_currency: null,
          note_type: null,
          note_severity: null,
          note_message: null,
          note_metadata: null,
          movements_primary_asset: 'BTC',
          movements_primary_amount: '1.0',
          movements_primary_direction: 'in',
          movements_secondary_asset: null,
          movements_secondary_amount: null,
          movements_secondary_direction: null,
          movements_fee_asset: null,
          movements_fee_amount: null,
          created_at: '2024-01-01T13:00:00.000Z',
        } as unknown as StoredTransaction,
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

    it('should skip transactions without primary movement data', () => {
      const service = new TransactionLinkingService(logger, DEFAULT_MATCHING_CONFIG);

      const transactions: StoredTransaction[] = [
        {
          id: 1,
          import_session_id: 1,
          wallet_address_id: null,
          source_id: 'kraken',
          source_type: 'exchange',
          external_id: 'W123',
          transaction_status: 'confirmed',
          transaction_datetime: '2024-01-01T12:00:00.000Z',
          from_address: null,
          to_address: null,
          verified: true,
          price: null,
          price_currency: null,
          note_type: null,
          note_severity: null,
          note_message: null,
          note_metadata: null,
          movements_primary_asset: null, // Missing
          movements_primary_amount: null, // Missing
          movements_primary_direction: null, // Missing
          movements_secondary_asset: null,
          movements_secondary_amount: null,
          movements_secondary_direction: null,
          movements_fee_asset: null,
          movements_fee_amount: null,
          created_at: '2024-01-01T12:00:00.000Z',
        } as unknown as StoredTransaction,
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
        {
          id: 1,
          import_session_id: 1,
          wallet_address_id: null,
          source_id: 'bitcoin',
          source_type: 'blockchain',
          external_id: 'txsend',
          transaction_status: 'confirmed',
          transaction_datetime: '2024-01-01T12:00:00.000Z',
          from_address: 'bc1qsource',
          to_address: 'bc1qtarget',
          verified: true,
          price: null,
          price_currency: null,
          note_type: null,
          note_severity: null,
          note_message: null,
          note_metadata: null,
          movements_primary_asset: 'BTC',
          movements_primary_amount: '0.5',
          movements_primary_direction: 'out',
          movements_secondary_asset: null,
          movements_secondary_amount: null,
          movements_secondary_direction: null,
          movements_fee_asset: null,
          movements_fee_amount: null,
          created_at: '2024-01-01T12:00:00.000Z',
        } as unknown as StoredTransaction,
        {
          id: 2,
          import_session_id: 2,
          wallet_address_id: null,
          source_id: 'bitcoin',
          source_type: 'blockchain',
          external_id: 'txrecv',
          transaction_status: 'confirmed',
          transaction_datetime: '2024-01-01T12:15:00.000Z',
          from_address: 'bc1qtarget',
          to_address: 'bc1qreceiver',
          verified: true,
          price: null,
          price_currency: null,
          note_type: null,
          note_severity: null,
          note_message: null,
          note_metadata: null,
          movements_primary_asset: 'BTC',
          movements_primary_amount: '0.4999', // Slight fee deduction
          movements_primary_direction: 'in',
          movements_secondary_asset: null,
          movements_secondary_amount: null,
          movements_secondary_direction: null,
          movements_fee_asset: null,
          movements_fee_amount: null,
          created_at: '2024-01-01T12:15:00.000Z',
        } as unknown as StoredTransaction,
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
        // Matched source
        // Matched source
        {
          id: 1,
          import_session_id: 1,
          wallet_address_id: null,
          source_id: 'kraken',
          source_type: 'exchange',
          external_id: 'W123',
          transaction_status: 'confirmed',
          transaction_datetime: '2024-01-01T12:00:00.000Z',
          from_address: null,
          to_address: null,
          verified: true,
          price: null,
          price_currency: null,
          note_type: null,
          note_severity: null,
          note_message: null,
          note_metadata: null,
          movements_primary_asset: 'BTC',
          movements_primary_amount: '1.0',
          movements_primary_direction: 'out',
          movements_secondary_asset: null,
          movements_secondary_amount: null,
          movements_secondary_direction: null,
          movements_fee_asset: null,
          movements_fee_amount: null,
          created_at: '2024-01-01T12:00:00.000Z',
        } as unknown as StoredTransaction,
        // Unmatched source (different asset)
        // Unmatched source (different asset)
        {
          id: 2,
          import_session_id: 1,
          wallet_address_id: null,
          source_id: 'kraken',
          source_type: 'exchange',
          external_id: 'W124',
          transaction_status: 'confirmed',
          transaction_datetime: '2024-01-01T12:00:00.000Z',
          from_address: null,
          to_address: null,
          verified: true,
          price: null,
          price_currency: null,
          note_type: null,
          note_severity: null,
          note_message: null,
          note_metadata: null,
          movements_primary_asset: 'ETH',
          movements_primary_amount: '10.0',
          movements_primary_direction: 'out',
          movements_secondary_asset: null,
          movements_secondary_amount: null,
          movements_secondary_direction: null,
          movements_fee_asset: null,
          movements_fee_amount: null,
          created_at: '2024-01-01T12:00:00.000Z',
        } as unknown as StoredTransaction,
        // Matched target
        // Matched target
        {
          id: 3,
          import_session_id: 2,
          wallet_address_id: null,
          source_id: 'bitcoin',
          source_type: 'blockchain',
          external_id: 'txabc',
          transaction_status: 'confirmed',
          transaction_datetime: '2024-01-01T13:00:00.000Z',
          from_address: null,
          to_address: null,
          verified: true,
          price: null,
          price_currency: null,
          note_type: null,
          note_severity: null,
          note_message: null,
          note_metadata: null,
          movements_primary_asset: 'BTC',
          movements_primary_amount: '1.0',
          movements_primary_direction: 'in',
          movements_secondary_asset: null,
          movements_secondary_amount: null,
          movements_secondary_direction: null,
          movements_fee_asset: null,
          movements_fee_amount: null,
          created_at: '2024-01-01T13:00:00.000Z',
        } as unknown as StoredTransaction,
        // Unmatched target
        // Unmatched target
        {
          id: 4,
          import_session_id: 2,
          wallet_address_id: null,
          source_id: 'ethereum',
          source_type: 'blockchain',
          external_id: 'txdef',
          transaction_status: 'confirmed',
          transaction_datetime: '2024-01-01T13:00:00.000Z',
          from_address: null,
          to_address: null,
          verified: true,
          price: null,
          price_currency: null,
          note_type: null,
          note_severity: null,
          note_message: null,
          note_metadata: null,
          movements_primary_asset: 'USDT',
          movements_primary_amount: '1000.0',
          movements_primary_direction: 'in',
          movements_secondary_asset: null,
          movements_secondary_amount: null,
          movements_secondary_direction: null,
          movements_fee_asset: null,
          movements_fee_amount: null,
          created_at: '2024-01-01T13:00:00.000Z',
        } as unknown as StoredTransaction,
      ];

      const result = service.linkTransactions(transactions);

      expect(result.isOk()).toBe(true);

      if (result.isOk()) {
        const {
          totalSourceTransactions,
          totalTargetTransactions,
          matchedCount,
          unmatchedSourceCount,
          unmatchedTargetCount,
        } = result.value;

        expect(totalSourceTransactions).toBe(2); // BTC and ETH withdrawals
        expect(totalTargetTransactions).toBe(2); // BTC and USDT deposits
        expect(matchedCount).toBe(2); // 1 source + 1 target matched
        expect(unmatchedSourceCount).toBe(1); // ETH withdrawal unmatched
        expect(unmatchedTargetCount).toBe(1); // USDT deposit unmatched
      }
    });
  });

  describe('convertToCandidates', () => {
    it('should convert valid transactions to candidates', () => {
      const service = new TransactionLinkingService(logger, DEFAULT_MATCHING_CONFIG);

      const transactions: StoredTransaction[] = [
        {
          id: 1,
          import_session_id: 1,
          wallet_address_id: null,
          source_id: 'kraken',
          source_type: 'exchange',
          external_id: 'W123',
          transaction_status: 'confirmed',
          transaction_datetime: '2024-01-01T12:00:00.000Z',
          from_address: null,
          to_address: 'bc1qtest',
          verified: true,
          price: null,
          price_currency: null,
          note_type: null,
          note_severity: null,
          note_message: null,
          note_metadata: null,
          movements_primary_asset: 'BTC',
          movements_primary_amount: '1.0',
          movements_primary_direction: 'out',
          movements_secondary_asset: null,
          movements_secondary_amount: null,
          movements_secondary_direction: null,
          movements_fee_asset: null,
          movements_fee_amount: null,
          created_at: '2024-01-01T12:00:00.000Z',
        } as unknown as StoredTransaction,
      ];

      const result = service.linkTransactions(transactions);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        // Should have 1 source (the withdrawal)
        expect(result.value.totalSourceTransactions).toBe(1);
        expect(result.value.totalTargetTransactions).toBe(0);
      }
    });

    it('should skip transactions with missing movement data', () => {
      const service = new TransactionLinkingService(logger, DEFAULT_MATCHING_CONFIG);

      const transactions: StoredTransaction[] = [
        {
          id: 1,
          import_session_id: 1,
          wallet_address_id: null,
          source_id: 'kraken',
          source_type: 'exchange',
          external_id: 'W123',
          transaction_status: 'confirmed',
          transaction_datetime: '2024-01-01T12:00:00.000Z',
          from_address: null,
          to_address: null,
          verified: true,
          price: null,
          price_currency: null,
          note_type: null,
          note_severity: null,
          note_message: null,
          note_metadata: null,
          movements_primary_asset: 'BTC',
          movements_primary_amount: null, // Missing
          movements_primary_direction: 'out',
          movements_secondary_asset: null,
          movements_secondary_amount: null,
          movements_secondary_direction: null,
          movements_fee_asset: null,
          movements_fee_amount: null,
          created_at: '2024-01-01T12:00:00.000Z',
        } as unknown as StoredTransaction,
        {
          id: 2,
          import_session_id: 1,
          wallet_address_id: null,
          source_id: 'kraken',
          source_type: 'exchange',
          external_id: 'W124',
          transaction_status: 'confirmed',
          transaction_datetime: '2024-01-01T12:00:00.000Z',
          from_address: null,
          to_address: null,
          verified: true,
          price: null,
          price_currency: null,
          note_type: null,
          note_severity: null,
          note_message: null,
          note_metadata: null,
          movements_primary_asset: null, // Missing
          movements_primary_amount: '1.0',
          movements_primary_direction: 'out',
          movements_secondary_asset: null,
          movements_secondary_amount: null,
          movements_secondary_direction: null,
          movements_fee_asset: null,
          movements_fee_amount: null,
          created_at: '2024-01-01T12:00:00.000Z',
        } as unknown as StoredTransaction,
        {
          id: 3,
          import_session_id: 1,
          wallet_address_id: null,
          source_id: 'kraken',
          source_type: 'exchange',
          external_id: 'W125',
          transaction_status: 'confirmed',
          transaction_datetime: '2024-01-01T12:00:00.000Z',
          from_address: null,
          to_address: null,
          verified: true,
          price: null,
          price_currency: null,
          note_type: null,
          note_severity: null,
          note_message: null,
          note_metadata: null,
          movements_primary_asset: 'BTC',
          movements_primary_amount: '1.0',
          movements_primary_direction: null, // Missing
          movements_secondary_asset: null,
          movements_secondary_amount: null,
          movements_secondary_direction: null,
          movements_fee_asset: null,
          movements_fee_amount: null,
          created_at: '2024-01-01T12:00:00.000Z',
        } as unknown as StoredTransaction,
      ];

      const result = service.linkTransactions(transactions);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        // All transactions should be skipped
        expect(result.value.totalSourceTransactions).toBe(0);
        expect(result.value.totalTargetTransactions).toBe(0);
      }
    });

    it('should handle neutral direction transactions', () => {
      const service = new TransactionLinkingService(logger, DEFAULT_MATCHING_CONFIG);

      const transactions: StoredTransaction[] = [
        {
          id: 1,
          import_session_id: 1,
          wallet_address_id: null,
          source_id: 'kraken',
          source_type: 'exchange',
          external_id: 'T123',
          transaction_status: 'confirmed',
          transaction_datetime: '2024-01-01T12:00:00.000Z',
          from_address: null,
          to_address: null,
          verified: true,
          price: null,
          price_currency: null,
          note_type: null,
          note_severity: null,
          note_message: null,
          note_metadata: null,
          movements_primary_asset: 'BTC',
          movements_primary_amount: '1.0',
          movements_primary_direction: 'neutral',
          movements_secondary_asset: null,
          movements_secondary_amount: null,
          movements_secondary_direction: null,
          movements_fee_asset: null,
          movements_fee_amount: null,
          created_at: '2024-01-01T12:00:00.000Z',
        } as unknown as StoredTransaction,
      ];

      const result = service.linkTransactions(transactions);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        // Neutral transactions should not be sources or targets
        expect(result.value.totalSourceTransactions).toBe(0);
        expect(result.value.totalTargetTransactions).toBe(0);
      }
    });
  });

  describe('deduplication', () => {
    it('should keep only highest confidence match per target', () => {
      const service = new TransactionLinkingService(logger, DEFAULT_MATCHING_CONFIG);

      const transactions: StoredTransaction[] = [
        // Source 1 - closer in time (higher confidence)
        // Source 1 - closer in time (higher confidence)
        {
          id: 1,
          import_session_id: 1,
          wallet_address_id: null,
          source_id: 'kraken',
          source_type: 'exchange',
          external_id: 'W123',
          transaction_status: 'confirmed',
          transaction_datetime: '2024-01-01T12:00:00.000Z',
          from_address: null,
          to_address: 'bc1qtarget',
          verified: true,
          price: null,
          price_currency: null,
          note_type: null,
          note_severity: null,
          note_message: null,
          note_metadata: null,
          movements_primary_asset: 'BTC',
          movements_primary_amount: '1.0',
          movements_primary_direction: 'out',
          movements_secondary_asset: null,
          movements_secondary_amount: null,
          movements_secondary_direction: null,
          movements_fee_asset: null,
          movements_fee_amount: null,
          created_at: '2024-01-01T12:00:00.000Z',
        } as unknown as StoredTransaction,
        // Source 2 - farther in time (lower confidence)
        // Source 2 - farther in time (lower confidence)
        {
          id: 2,
          import_session_id: 1,
          wallet_address_id: null,
          source_id: 'kraken',
          source_type: 'exchange',
          external_id: 'W124',
          transaction_status: 'confirmed',
          transaction_datetime: '2024-01-01T10:00:00.000Z',
          from_address: null,
          to_address: 'bc1qtarget',
          verified: true,
          price: null,
          price_currency: null,
          note_type: null,
          note_severity: null,
          note_message: null,
          note_metadata: null,
          movements_primary_asset: 'BTC',
          movements_primary_amount: '1.0',
          movements_primary_direction: 'out',
          movements_secondary_asset: null,
          movements_secondary_amount: null,
          movements_secondary_direction: null,
          movements_fee_asset: null,
          movements_fee_amount: null,
          created_at: '2024-01-01T10:00:00.000Z',
        } as unknown as StoredTransaction,
        // Target - should match to source 1 (closer)
        // Target - should match to source 1 (closer)
        {
          id: 3,
          import_session_id: 2,
          wallet_address_id: null,
          source_id: 'bitcoin',
          source_type: 'blockchain',
          external_id: 'txabc',
          transaction_status: 'confirmed',
          transaction_datetime: '2024-01-01T13:00:00.000Z',
          from_address: 'bc1qtarget',
          to_address: 'bc1qfinal',
          verified: true,
          price: null,
          price_currency: null,
          note_type: null,
          note_severity: null,
          note_message: null,
          note_metadata: null,
          movements_primary_asset: 'BTC',
          movements_primary_amount: '1.0',
          movements_primary_direction: 'in',
          movements_secondary_asset: null,
          movements_secondary_amount: null,
          movements_secondary_direction: null,
          movements_fee_asset: null,
          movements_fee_amount: null,
          created_at: '2024-01-01T13:00:00.000Z',
        } as unknown as StoredTransaction,
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
        {
          id: 1,
          import_session_id: 1,
          wallet_address_id: null,
          source_id: 'kraken',
          source_type: 'exchange',
          external_id: 'W123',
          transaction_status: 'confirmed',
          transaction_datetime: '2024-01-01T12:00:00.000Z',
          from_address: null,
          to_address: 'bc1qtest',
          verified: true,
          price: null,
          price_currency: null,
          note_type: null,
          note_severity: null,
          note_message: null,
          note_metadata: null,
          movements_primary_asset: 'BTC',
          movements_primary_amount: '1.0',
          movements_primary_direction: 'out',
          movements_secondary_asset: null,
          movements_secondary_amount: null,
          movements_secondary_direction: null,
          movements_fee_asset: null,
          movements_fee_amount: null,
          created_at: '2024-01-01T12:00:00.000Z',
        } as unknown as StoredTransaction,
        {
          id: 2,
          import_session_id: 2,
          wallet_address_id: null,
          source_id: 'bitcoin',
          source_type: 'blockchain',
          external_id: 'txabc',
          transaction_status: 'confirmed',
          transaction_datetime: '2024-01-01T12:30:00.000Z',
          from_address: 'bc1qtest',
          to_address: 'bc1qfinal',
          verified: true,
          price: null,
          price_currency: null,
          note_type: null,
          note_severity: null,
          note_message: null,
          note_metadata: null,
          movements_primary_asset: 'BTC',
          movements_primary_amount: '1.0',
          movements_primary_direction: 'in',
          movements_secondary_asset: null,
          movements_secondary_amount: null,
          movements_secondary_direction: null,
          movements_fee_asset: null,
          movements_fee_amount: null,
          created_at: '2024-01-01T12:30:00.000Z',
        } as unknown as StoredTransaction,
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
        {
          id: 1,
          import_session_id: 1,
          wallet_address_id: null,
          source_id: 'kraken',
          source_type: 'exchange',
          external_id: 'W123',
          transaction_status: 'confirmed',
          transaction_datetime: '2024-01-01T12:00:00.000Z',
          from_address: null,
          to_address: null, // No address
          verified: true,
          price: null,
          price_currency: null,
          note_type: null,
          note_severity: null,
          note_message: null,
          note_metadata: null,
          movements_primary_asset: 'BTC',
          movements_primary_amount: '1.0',
          movements_primary_direction: 'out',
          movements_secondary_asset: null,
          movements_secondary_amount: null,
          movements_secondary_direction: null,
          movements_fee_asset: null,
          movements_fee_amount: null,
          created_at: '2024-01-01T12:00:00.000Z',
        } as unknown as StoredTransaction,
        {
          id: 2,
          import_session_id: 2,
          wallet_address_id: null,
          source_id: 'bitcoin',
          source_type: 'blockchain',
          external_id: 'txabc',
          transaction_status: 'confirmed',
          transaction_datetime: '2024-01-02T00:00:00.000Z', // 12 hours later
          from_address: null, // No address
          to_address: null,
          verified: true,
          price: null,
          price_currency: null,
          note_type: null,
          note_severity: null,
          note_message: null,
          note_metadata: null,
          movements_primary_asset: 'BTC',
          movements_primary_amount: '0.98', // Slightly lower (2% fee)
          movements_primary_direction: 'in',
          movements_secondary_asset: null,
          movements_secondary_amount: null,
          movements_secondary_direction: null,
          movements_fee_asset: null,
          movements_fee_amount: null,
          created_at: '2024-01-02T00:00:00.000Z',
        } as unknown as StoredTransaction,
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
