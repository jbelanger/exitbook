/**
 * Tests for EVM importer utility functions
 * Tests the pure mapping function that converts provider transactions to external transactions
 */

import type { EvmTransaction, TransactionWithRawData } from '@exitbook/blockchain-providers';
import { describe, expect, test } from 'vitest';

import { mapToRawTransactions } from '../evm-importer-utils.js';

describe('evm-importer-utils', () => {
  describe('mapToRawTransactions', () => {
    test('should map normal transactions correctly', () => {
      const transactions: TransactionWithRawData<EvmTransaction>[] = [
        {
          normalized: {
            id: '0x123',
            type: 'transfer',
            status: 'success',
            providerName: 'alchemy',
            blockHeight: 100,
            from: '0xabc',
            to: '0xdef',
            amount: '1000000000000000000',
            currency: 'ETH',
            timestamp: 1234567890,
          },
          raw: { hash: '0x123', from: '0xabc', to: '0xdef' },
        },
      ];

      const result = mapToRawTransactions(transactions, 'alchemy', '0xsource', 'normal');

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        providerName: 'alchemy',
        sourceAddress: '0xsource',
        transactionTypeHint: 'normal',
        normalizedData: transactions[0]!.normalized,
        rawData: transactions[0]!.raw,
      });
      expect(result[0]!.externalId).toBeDefined();
      expect(typeof result[0]!.externalId).toBe('string');
    });

    test('should map internal transactions correctly', () => {
      const transactions: TransactionWithRawData<EvmTransaction>[] = [
        {
          normalized: {
            id: '0x456',
            type: 'internal',
            status: 'success',
            providerName: 'moralis',
            blockHeight: 101,
            from: '0xdef',
            to: '0xghi',
            amount: '500000000000000000',
            currency: 'ETH',
            timestamp: 1234567891,
          },
          raw: { hash: '0x456', from: '0xdef', to: '0xghi', type: 'internal' },
        },
      ];

      const result = mapToRawTransactions(transactions, 'moralis', '0xsource', 'internal');

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        providerName: 'moralis',
        sourceAddress: '0xsource',
        transactionTypeHint: 'internal',
        normalizedData: transactions[0]!.normalized,
        rawData: transactions[0]!.raw,
      });
    });

    test('should map token transactions correctly', () => {
      const transactions: TransactionWithRawData<EvmTransaction>[] = [
        {
          normalized: {
            id: '0x789',
            type: 'token_transfer',
            status: 'success',
            providerName: 'alchemy',
            blockHeight: 102,
            from: '0xabc',
            to: '0xdef',
            amount: '1000000',
            currency: 'USDC',
            timestamp: 1234567892,
            tokenAddress: '0xtoken',
          },
          raw: { hash: '0x789', tokenAddress: '0xtoken', value: '1000000' },
        },
      ];

      const result = mapToRawTransactions(transactions, 'alchemy', '0xsource', 'token');

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        providerName: 'alchemy',
        sourceAddress: '0xsource',
        transactionTypeHint: 'token',
        normalizedData: transactions[0]!.normalized,
        rawData: transactions[0]!.raw,
      });
    });

    test('should handle empty array', () => {
      const result = mapToRawTransactions([], 'alchemy', '0xsource', 'normal');

      expect(result).toHaveLength(0);
    });

    test('should handle multiple transactions', () => {
      const transactions: TransactionWithRawData<EvmTransaction>[] = [
        {
          normalized: {
            id: '0x111',
            type: 'transfer',
            status: 'success',
            providerName: 'alchemy',
            blockHeight: 100,
            from: '0xabc',
            to: '0xdef',
            amount: '1',
            currency: 'ETH',
            timestamp: 1,
          },
          raw: { hash: '0x111' },
        },
        {
          normalized: {
            id: '0x222',
            type: 'transfer',
            status: 'success',
            providerName: 'alchemy',
            blockHeight: 101,
            from: '0xabc',
            to: '0xdef',
            amount: '2',
            currency: 'ETH',
            timestamp: 2,
          },
          raw: { hash: '0x222' },
        },
        {
          normalized: {
            id: '0x333',
            type: 'transfer',
            status: 'success',
            providerName: 'alchemy',
            blockHeight: 102,
            from: '0xabc',
            to: '0xdef',
            amount: '3',
            currency: 'ETH',
            timestamp: 3,
          },
          raw: { hash: '0x333' },
        },
      ];

      const result = mapToRawTransactions(transactions, 'alchemy', '0xsource', 'normal');

      expect(result).toHaveLength(3);
      expect((result[0]!.normalizedData as EvmTransaction).id).toBe('0x111');
      expect((result[1]!.normalizedData as EvmTransaction).id).toBe('0x222');
      expect((result[2]!.normalizedData as EvmTransaction).id).toBe('0x333');
      expect(result[0]!.transactionTypeHint).toBe('normal');
      expect(result[1]!.transactionTypeHint).toBe('normal');
      expect(result[2]!.transactionTypeHint).toBe('normal');
    });

    test('should generate unique external IDs for each transaction', () => {
      const transactions: TransactionWithRawData<EvmTransaction>[] = [
        {
          normalized: {
            id: '0x111',
            type: 'transfer',
            status: 'success',
            providerName: 'alchemy',
            blockHeight: 100,
            from: '0xabc',
            to: '0xdef',
            amount: '1',
            currency: 'ETH',
            timestamp: 1,
          },
          raw: { hash: '0x111' },
        },
        {
          normalized: {
            id: '0x222',
            type: 'transfer',
            status: 'success',
            providerName: 'alchemy',
            blockHeight: 101,
            from: '0xabc',
            to: '0xdef',
            amount: '2',
            currency: 'ETH',
            timestamp: 2,
          },
          raw: { hash: '0x222' },
        },
      ];

      const result = mapToRawTransactions(transactions, 'alchemy', '0xsource', 'normal');

      expect(result[0]!.externalId).toBeDefined();
      expect(result[1]!.externalId).toBeDefined();
      expect(result[0]!.externalId).not.toBe(result[1]!.externalId);
    });

    test('should preserve all raw data fields', () => {
      const rawData = {
        hash: '0x123',
        from: '0xabc',
        to: '0xdef',
        value: '1000000000000000000',
        gas: '21000',
        gasPrice: '20000000000',
        nonce: 5,
        customField: 'custom value',
      };

      const transactions: TransactionWithRawData<EvmTransaction>[] = [
        {
          normalized: {
            id: '0x123',
            type: 'transfer',
            status: 'success',
            providerName: 'alchemy',
            blockHeight: 100,
            from: '0xabc',
            to: '0xdef',
            amount: '1000000000000000000',
            currency: 'ETH',
            timestamp: 1234567890,
          },
          raw: rawData,
        },
      ];

      const result = mapToRawTransactions(transactions, 'alchemy', '0xsource', 'normal');

      expect(result[0]!.rawData).toEqual(rawData);
    });
  });
});
