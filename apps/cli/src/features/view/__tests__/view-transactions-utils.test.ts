/* eslint-disable unicorn/no-useless-undefined -- acceptable for tests */
/* eslint-disable unicorn/no-null -- acceptable for tests */
import { describe, expect, it } from 'vitest';

import type { TransactionInfo } from '../view-transactions-utils.ts';
import {
  formatOperationLabel,
  formatTransactionForDisplay,
  formatTransactionsListForDisplay,
  getDirectionIcon,
} from '../view-transactions-utils.ts';

describe('view-transactions-utils', () => {
  describe('getDirectionIcon', () => {
    it('should return left arrow for in direction', () => {
      expect(getDirectionIcon('in')).toBe('←');
    });

    it('should return right arrow for out direction', () => {
      expect(getDirectionIcon('out')).toBe('→');
    });

    it('should return bidirectional arrow for null direction', () => {
      expect(getDirectionIcon(null)).toBe('↔');
    });

    it('should return bidirectional arrow for undefined direction', () => {
      expect(getDirectionIcon(undefined)).toBe('↔');
    });

    it('should return bidirectional arrow for unknown direction', () => {
      expect(getDirectionIcon('unknown')).toBe('↔');
    });
  });

  describe('formatOperationLabel', () => {
    it('should format category and type together', () => {
      expect(formatOperationLabel('trade', 'buy')).toBe('trade/buy');
    });

    it('should return Unknown when both are null', () => {
      expect(formatOperationLabel(null, null)).toBe('Unknown');
    });

    it('should return Unknown when both are undefined', () => {
      expect(formatOperationLabel(undefined, undefined)).toBe('Unknown');
    });

    it('should return Unknown when category is null', () => {
      expect(formatOperationLabel(null, 'buy')).toBe('Unknown');
    });

    it('should return Unknown when type is null', () => {
      expect(formatOperationLabel('trade', null)).toBe('Unknown');
    });

    it('should format different operation types', () => {
      expect(formatOperationLabel('deposit', 'fiat')).toBe('deposit/fiat');
      expect(formatOperationLabel('withdrawal', 'crypto')).toBe('withdrawal/crypto');
      expect(formatOperationLabel('transfer', 'internal')).toBe('transfer/internal');
    });
  });

  describe('formatTransactionForDisplay', () => {
    it('should format a complete transaction with all fields', () => {
      const tx: TransactionInfo = {
        id: 1,
        source_id: 'kraken',
        source_type: 'exchange',
        external_id: 'ext-123',
        transaction_datetime: '2024-01-15T10:30:00Z',
        operation_category: 'trade',
        operation_type: 'buy',
        movements_primary_asset: 'BTC',
        movements_primary_amount: '0.5',
        movements_primary_direction: 'in',
        from_address: '0xabc123',
        to_address: '0xdef456',
        blockchain_transaction_hash: '0x123456789',
      };

      const result = formatTransactionForDisplay(tx);

      expect(result).toContain('Transaction #1');
      expect(result).toContain('Source: kraken (exchange)');
      expect(result).toContain('Date: 2024-01-15T10:30:00Z');
      expect(result).toContain('Operation: trade/buy');
      expect(result).toContain('Movement: ← 0.5 BTC');
      expect(result).toContain('Hash: 0x123456789');
      expect(result).toContain('From: 0xabc123');
      expect(result).toContain('To: 0xdef456');
    });

    it('should format transaction without optional fields', () => {
      const tx: TransactionInfo = {
        id: 1,
        source_id: 'bitcoin',
        source_type: 'blockchain',
        external_id: null,
        transaction_datetime: '2024-01-15T10:30:00Z',
        operation_category: null,
        operation_type: null,
        movements_primary_asset: null,
        movements_primary_amount: null,
        movements_primary_direction: null,
        from_address: null,
        to_address: null,
        blockchain_transaction_hash: null,
      };

      const result = formatTransactionForDisplay(tx);

      expect(result).toContain('Transaction #1');
      expect(result).toContain('Source: bitcoin (blockchain)');
      expect(result).toContain('Operation: Unknown');
      expect(result).not.toContain('Movement:');
      expect(result).not.toContain('Hash:');
      expect(result).not.toContain('From:');
      expect(result).not.toContain('To:');
    });

    it('should format transaction with only from_address', () => {
      const tx: TransactionInfo = {
        id: 1,
        source_id: 'test',
        source_type: 'blockchain',
        external_id: null,
        transaction_datetime: '2024-01-15T10:30:00Z',
        operation_category: 'transfer',
        operation_type: 'send',
        movements_primary_asset: 'ETH',
        movements_primary_amount: '1.0',
        movements_primary_direction: 'out',
        from_address: '0xabc123',
        to_address: null,
        blockchain_transaction_hash: null,
      };

      const result = formatTransactionForDisplay(tx);

      expect(result).toContain('From: 0xabc123');
      expect(result).not.toContain('To:');
    });

    it('should format transaction with only to_address', () => {
      const tx: TransactionInfo = {
        id: 1,
        source_id: 'test',
        source_type: 'blockchain',
        external_id: null,
        transaction_datetime: '2024-01-15T10:30:00Z',
        operation_category: 'transfer',
        operation_type: 'receive',
        movements_primary_asset: 'ETH',
        movements_primary_amount: '1.0',
        movements_primary_direction: 'in',
        from_address: null,
        to_address: '0xdef456',
        blockchain_transaction_hash: null,
      };

      const result = formatTransactionForDisplay(tx);

      expect(result).not.toContain('From:');
      expect(result).toContain('To: 0xdef456');
    });

    it('should handle missing amount with question mark', () => {
      const tx: TransactionInfo = {
        id: 1,
        source_id: 'test',
        source_type: 'exchange',
        external_id: null,
        transaction_datetime: '2024-01-15T10:30:00Z',
        operation_category: 'trade',
        operation_type: 'buy',
        movements_primary_asset: 'BTC',
        movements_primary_amount: null,
        movements_primary_direction: 'in',
        from_address: null,
        to_address: null,
        blockchain_transaction_hash: null,
      };

      const result = formatTransactionForDisplay(tx);

      expect(result).toContain('Movement: ← ? BTC');
    });

    it('should format sell transaction with out direction', () => {
      const tx: TransactionInfo = {
        id: 1,
        source_id: 'kraken',
        source_type: 'exchange',
        external_id: null,
        transaction_datetime: '2024-01-15T10:30:00Z',
        operation_category: 'trade',
        operation_type: 'sell',
        movements_primary_asset: 'BTC',
        movements_primary_amount: '0.5',
        movements_primary_direction: 'out',
        from_address: null,
        to_address: null,
        blockchain_transaction_hash: null,
      };

      const result = formatTransactionForDisplay(tx);

      expect(result).toContain('Movement: → 0.5 BTC');
    });

    it('should format transaction with unknown direction', () => {
      const tx: TransactionInfo = {
        id: 1,
        source_id: 'test',
        source_type: 'exchange',
        external_id: null,
        transaction_datetime: '2024-01-15T10:30:00Z',
        operation_category: 'other',
        operation_type: 'unknown',
        movements_primary_asset: 'BTC',
        movements_primary_amount: '1.0',
        movements_primary_direction: null,
        from_address: null,
        to_address: null,
        blockchain_transaction_hash: null,
      };

      const result = formatTransactionForDisplay(tx);

      expect(result).toContain('Movement: ↔ 1.0 BTC');
    });
  });

  describe('formatTransactionsListForDisplay', () => {
    it('should format empty transactions list', () => {
      const result = formatTransactionsListForDisplay([], 0);

      expect(result).toContain('Transactions:');
      expect(result).toContain('=============================');
      expect(result).toContain('No transactions found.');
      expect(result).toContain('Total: 0 transactions');
    });

    it('should format single transaction', () => {
      const transactions: TransactionInfo[] = [
        {
          id: 1,
          source_id: 'kraken',
          source_type: 'exchange',
          external_id: null,
          transaction_datetime: '2024-01-15T10:30:00Z',
          operation_category: 'trade',
          operation_type: 'buy',
          movements_primary_asset: 'BTC',
          movements_primary_amount: '0.5',
          movements_primary_direction: 'in',
          from_address: null,
          to_address: null,
          blockchain_transaction_hash: null,
        },
      ];

      const result = formatTransactionsListForDisplay(transactions, 1);

      expect(result).toContain('Transaction #1');
      expect(result).toContain('Source: kraken (exchange)');
      expect(result).toContain('Total: 1 transactions');
    });

    it('should format multiple transactions', () => {
      const transactions: TransactionInfo[] = [
        {
          id: 1,
          source_id: 'kraken',
          source_type: 'exchange',
          external_id: null,
          transaction_datetime: '2024-01-15T10:30:00Z',
          operation_category: 'trade',
          operation_type: 'buy',
          movements_primary_asset: 'BTC',
          movements_primary_amount: '0.5',
          movements_primary_direction: 'in',
          from_address: null,
          to_address: null,
          blockchain_transaction_hash: null,
        },
        {
          id: 2,
          source_id: 'bitcoin',
          source_type: 'blockchain',
          external_id: null,
          transaction_datetime: '2024-01-15T11:00:00Z',
          operation_category: 'transfer',
          operation_type: 'send',
          movements_primary_asset: 'BTC',
          movements_primary_amount: '0.1',
          movements_primary_direction: 'out',
          from_address: '0xabc',
          to_address: '0xdef',
          blockchain_transaction_hash: '0x123',
        },
        {
          id: 3,
          source_id: 'ethereum',
          source_type: 'blockchain',
          external_id: null,
          transaction_datetime: '2024-01-15T12:00:00Z',
          operation_category: 'deposit',
          operation_type: 'receive',
          movements_primary_asset: 'ETH',
          movements_primary_amount: '2.0',
          movements_primary_direction: 'in',
          from_address: null,
          to_address: null,
          blockchain_transaction_hash: null,
        },
      ];

      const result = formatTransactionsListForDisplay(transactions, 3);

      expect(result).toContain('Transaction #1');
      expect(result).toContain('Transaction #2');
      expect(result).toContain('Transaction #3');
      expect(result).toContain('Total: 3 transactions');
    });

    it('should show correct total even when displaying fewer transactions', () => {
      const transactions: TransactionInfo[] = [
        {
          id: 1,
          source_id: 'kraken',
          source_type: 'exchange',
          external_id: null,
          transaction_datetime: '2024-01-15T10:30:00Z',
          operation_category: 'trade',
          operation_type: 'buy',
          movements_primary_asset: 'BTC',
          movements_primary_amount: '0.5',
          movements_primary_direction: 'in',
          from_address: null,
          to_address: null,
          blockchain_transaction_hash: null,
        },
      ];

      const result = formatTransactionsListForDisplay(transactions, 100);

      expect(result).toContain('Transaction #1');
      expect(result).toContain('Total: 100 transactions');
    });

    it('should include blank lines between transactions', () => {
      const transactions: TransactionInfo[] = [
        {
          id: 1,
          source_id: 'test1',
          source_type: 'exchange',
          external_id: null,
          transaction_datetime: '2024-01-15T10:30:00Z',
          operation_category: 'trade',
          operation_type: 'buy',
          movements_primary_asset: 'BTC',
          movements_primary_amount: '1',
          movements_primary_direction: 'in',
          from_address: null,
          to_address: null,
          blockchain_transaction_hash: null,
        },
        {
          id: 2,
          source_id: 'test2',
          source_type: 'exchange',
          external_id: null,
          transaction_datetime: '2024-01-15T10:30:00Z',
          operation_category: 'trade',
          operation_type: 'buy',
          movements_primary_asset: 'BTC',
          movements_primary_amount: '1',
          movements_primary_direction: 'in',
          from_address: null,
          to_address: null,
          blockchain_transaction_hash: null,
        },
      ];

      const result = formatTransactionsListForDisplay(transactions, 2);
      const lines = result.split('\n');

      const tx2Index = lines.findIndex((line) => line.includes('Transaction #2'));

      expect(lines[tx2Index - 1]).toBe('');
    });
  });
});
