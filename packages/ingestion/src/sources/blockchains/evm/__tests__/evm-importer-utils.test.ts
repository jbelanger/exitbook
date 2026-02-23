/**
 * Tests for EVM importer utility functions
 * Tests the pure mapping function that converts provider transactions to external transactions
 */

import type { EvmTransaction, TransactionWithRawData } from '@exitbook/blockchain-providers';
import { describe, expect, test } from 'vitest';

import { mapToRawTransactions } from '../evm-importer-utils.js';

describe('evm-importer-utils', () => {
  const createTransaction = (
    overrides: Partial<EvmTransaction> = {},
    rawOverrides: Record<string, unknown> = {}
  ): TransactionWithRawData<EvmTransaction> => {
    const id = overrides.id ?? '0x123';
    const normalized: EvmTransaction = {
      id,
      eventId: overrides.eventId ?? `${id}-0`,
      type: 'transfer',
      status: 'success',
      providerName: 'alchemy',
      blockHeight: 100,
      from: '0xabc',
      to: '0xdef',
      amount: '1000000000000000000',
      currency: 'ETH',
      timestamp: 1234567890,
      ...overrides,
    };

    return {
      normalized,
      raw: {
        hash: normalized.id,
        from: normalized.from,
        to: normalized.to,
        ...rawOverrides,
      },
    };
  };

  describe('mapToRawTransactions', () => {
    test('should map normal transactions correctly', () => {
      const transactions = [createTransaction()];

      const result = mapToRawTransactions(transactions, 'alchemy', '0xsource');

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        providerName: 'alchemy',
        sourceAddress: '0xsource',
        transactionTypeHint: 'normal',
        normalizedData: transactions[0]!.normalized,
        providerData: transactions[0]!.raw,
      });
      expect(result[0]!.eventId).toBeDefined();
      expect(typeof result[0]!.eventId).toBe('string');
    });

    test('should map internal transactions correctly', () => {
      const transactions = [
        createTransaction(
          {
            id: '0x456',
            type: 'internal',
            providerName: 'moralis',
            blockHeight: 101,
            from: '0xdef',
            to: '0xghi',
            amount: '500000000000000000',
            timestamp: 1234567891,
          },
          { type: 'internal' }
        ),
      ];

      const result = mapToRawTransactions(transactions, 'moralis', '0xsource');

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        providerName: 'moralis',
        sourceAddress: '0xsource',
        transactionTypeHint: 'internal',
        normalizedData: transactions[0]!.normalized,
        providerData: transactions[0]!.raw,
      });
    });

    test('should map token transactions correctly', () => {
      const transactions = [
        createTransaction(
          {
            id: '0x789',
            type: 'token_transfer',
            blockHeight: 102,
            amount: '1000000',
            currency: 'USDC',
            timestamp: 1234567892,
            tokenAddress: '0xtoken',
          },
          { tokenAddress: '0xtoken', value: '1000000' }
        ),
      ];

      const result = mapToRawTransactions(transactions, 'alchemy', '0xsource');

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        providerName: 'alchemy',
        sourceAddress: '0xsource',
        transactionTypeHint: 'token',
        normalizedData: transactions[0]!.normalized,
        providerData: transactions[0]!.raw,
      });
    });

    test('should handle empty array', () => {
      const result = mapToRawTransactions([], 'alchemy', '0xsource');

      expect(result).toHaveLength(0);
    });

    test('should handle multiple transactions', () => {
      const transactions = [
        createTransaction({ id: '0x111', blockHeight: 100, amount: '1', timestamp: 1 }),
        createTransaction({ id: '0x222', blockHeight: 101, amount: '2', timestamp: 2 }),
        createTransaction({ id: '0x333', blockHeight: 102, amount: '3', timestamp: 3 }),
      ];

      const result = mapToRawTransactions(transactions, 'alchemy', '0xsource');

      expect(result).toHaveLength(3);
      expect((result[0]!.normalizedData as EvmTransaction).id).toBe('0x111');
      expect((result[1]!.normalizedData as EvmTransaction).id).toBe('0x222');
      expect((result[2]!.normalizedData as EvmTransaction).id).toBe('0x333');
      expect(result[0]!.transactionTypeHint).toBe('normal');
      expect(result[1]!.transactionTypeHint).toBe('normal');
      expect(result[2]!.transactionTypeHint).toBe('normal');
    });

    test('should generate unique external IDs for each transaction', () => {
      const transactions = [
        createTransaction({ id: '0x111', blockHeight: 100, amount: '1', timestamp: 1 }),
        createTransaction({ id: '0x222', blockHeight: 101, amount: '2', timestamp: 2 }),
      ];

      const result = mapToRawTransactions(transactions, 'alchemy', '0xsource');

      expect(result[0]!.eventId).toBeDefined();
      expect(result[1]!.eventId).toBeDefined();
      expect(result[0]!.eventId).not.toBe(result[1]!.eventId);
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

      const transactions = [createTransaction({}, rawData)];

      const result = mapToRawTransactions(transactions, 'alchemy', '0xsource');

      expect(result[0]!.providerData).toEqual(rawData);
    });

    test('should derive hint from transaction.type, not the stream it came from', () => {
      // Moralis includes internal transactions in the normal stream;
      // the hint must reflect the actual transaction type, not the stream
      const transactions = [
        createTransaction(
          {
            id: '0xparenthash',
            type: 'internal',
            providerName: 'moralis',
            from: '0xcontract1',
            to: '0xcontract2',
          },
          { type: 'CALL' }
        ),
      ];

      const result = mapToRawTransactions(transactions, 'moralis', '0xsource');

      expect(result).toHaveLength(1);
      expect(result[0]!.transactionTypeHint).toBe('internal');
    });

    test('should map beacon_withdrawal type to beacon_withdrawal hint', () => {
      const transactions = [
        createTransaction(
          {
            id: 'beacon-withdrawal-12345',
            type: 'beacon_withdrawal',
            providerName: 'etherscan',
            from: '0x0000000000000000000000000000000000000000',
            to: '0xrecipient',
          },
          { withdrawalIndex: '12345', validatorIndex: '67890' }
        ),
      ];

      const result = mapToRawTransactions(transactions, 'etherscan', '0xrecipient');

      expect(result).toHaveLength(1);
      expect(result[0]!.transactionTypeHint).toBe('beacon_withdrawal');
    });
  });
});
