import { describe, expect, it } from 'vitest';

import { Money } from '../../../value-objects/money/money.vo';
import { Entry } from '../entry.entity';
import { CurrencyLookup, LedgerTransaction, TransactionState } from '../ledger-transaction.aggregate';
import {
  EmptyTransactionError,
  TransactionFinalizedError,
  UnbalancedTransactionError,
  TransactionValidationError,
} from '../transaction.errors';

describe('LedgerTransaction Aggregate', () => {
  // Mock currency lookup function
  const mockCurrencyLookup: CurrencyLookup = async (ticker: string) => {
    const currencies = {
      BTC: { id: 1, ticker: 'BTC' },
      ETH: { id: 3, ticker: 'ETH' },
      USD: { id: 2, ticker: 'USD' },
    };
    return currencies[ticker as keyof typeof currencies] || undefined;
  };
  describe('create', () => {
    it('should create valid transaction', () => {
      const result = LedgerTransaction.create({
        description: 'Bitcoin purchase',
        externalId: 'ext-456',
        source: 'kraken',
        userId: 'user-123',
      });

      expect(result.isOk()).toBe(true);
      const transaction = result._unsafeUnwrap();
      expect(transaction.userId).toBe('user-123');
      expect(transaction.externalId).toBe('ext-456');
      expect(transaction.source).toBe('kraken');
      expect(transaction.description).toBe('Bitcoin purchase');
      expect(transaction.state).toBe(TransactionState.DRAFT);
      expect(transaction.getEntryCount()).toBe(0);
      expect(transaction.isFinalized()).toBe(false);
    });

    it('should create transaction with metadata', () => {
      const metadata = { exchangeOrderId: '12345', type: 'trade' };
      const result = LedgerTransaction.create({
        description: 'Bitcoin trade',
        externalId: 'ext-456',
        metadata,
        source: 'kraken',
        userId: 'user-123',
      });

      expect(result.isOk()).toBe(true);
      const transaction = result._unsafeUnwrap();
      expect(transaction.metadata).toEqual(metadata);
      expect(transaction.metadata).not.toBe(metadata); // Should be a copy
    });

    it('should fail validation with empty userId', () => {
      const result = LedgerTransaction.create({
        description: 'Bitcoin purchase',
        externalId: 'ext-456',
        source: 'kraken',
        userId: '',
      });

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr()).toBeInstanceOf(TransactionValidationError);
    });

    it('should fail validation with empty externalId', () => {
      const result = LedgerTransaction.create({
        description: 'Bitcoin purchase',
        externalId: '',
        source: 'kraken',
        userId: 'user-123',
      });

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr()).toBeInstanceOf(TransactionValidationError);
    });
  });

  describe('addEntry', () => {
    it('should add entry to draft transaction', () => {
      const transactionResult = LedgerTransaction.create({
        description: 'Bitcoin purchase',
        externalId: 'ext-456',
        source: 'kraken',
        userId: 'user-123',
      });
      expect(transactionResult.isOk()).toBe(true);
      const transaction = transactionResult._unsafeUnwrap();

      const moneyResult = Money.fromDecimal(100, 'USD', 2);
      expect(moneyResult.isOk()).toBe(true);
      const money = moneyResult._unsafeUnwrap();

      const entryResult = Entry.create({
        accountId: 1,
        amount: money,
        description: 'Debit cash',
      });
      expect(entryResult.isOk()).toBe(true);
      const entry = entryResult._unsafeUnwrap();

      const addResult = transaction.addEntry(entry);
      expect(addResult.isOk()).toBe(true);
      expect(transaction.getEntryCount()).toBe(1);
      expect(transaction.entries).toHaveLength(1);
    });

    it('should fail to add entry to finalized transaction', async () => {
      // Create and finalize a balanced transaction
      const transactionResult = LedgerTransaction.create({
        description: 'Bitcoin purchase',
        externalId: 'ext-456',
        source: 'kraken',
        userId: 'user-123',
      });
      const transaction = transactionResult._unsafeUnwrap();

      // Add balanced entries
      const debitResult = Money.fromDecimal(100, 'USD', 2);
      const creditResult = Money.fromDecimal(-100, 'USD', 2);
      const debitEntry = Entry.create({ accountId: 1, amount: debitResult._unsafeUnwrap() })._unsafeUnwrap();
      const creditEntry = Entry.create({ accountId: 2, amount: creditResult._unsafeUnwrap() })._unsafeUnwrap();

      transaction.addEntry(debitEntry);
      transaction.addEntry(creditEntry);

      const finalizeResult = await transaction.finalize(mockCurrencyLookup);
      expect(finalizeResult.isOk()).toBe(true);

      // Try to add another entry
      const newEntryResult = Entry.create({
        accountId: 3,
        amount: Money.fromDecimal(50, 'USD', 2)._unsafeUnwrap(),
      });
      const newEntry = newEntryResult._unsafeUnwrap();

      const addResult = transaction.addEntry(newEntry);
      expect(addResult.isErr()).toBe(true);
      expect(addResult._unsafeUnwrapErr()).toBeInstanceOf(TransactionFinalizedError);
    });
  });

  describe('finalize', () => {
    it('should finalize balanced transaction', async () => {
      const transactionResult = LedgerTransaction.create({
        description: 'Bitcoin purchase',
        externalId: 'ext-456',
        source: 'kraken',
        userId: 'user-123',
      });
      const transaction = transactionResult._unsafeUnwrap();

      // Add balanced entries in USD
      const debitMoney = Money.fromDecimal(100, 'USD', 2)._unsafeUnwrap();
      const creditMoney = Money.fromDecimal(-100, 'USD', 2)._unsafeUnwrap();

      const debitEntry = Entry.create({ accountId: 1, amount: debitMoney })._unsafeUnwrap();
      const creditEntry = Entry.create({ accountId: 2, amount: creditMoney })._unsafeUnwrap();

      transaction.addEntry(debitEntry);
      transaction.addEntry(creditEntry);

      const result = await transaction.finalize(mockCurrencyLookup);
      expect(result.isOk()).toBe(true);
      expect(transaction.isFinalized()).toBe(true);
      expect(transaction.isBalanced()).toBe(true);
    });

    it('should fail to finalize empty transaction', async () => {
      const transactionResult = LedgerTransaction.create({
        description: 'Bitcoin purchase',
        externalId: 'ext-456',
        source: 'kraken',
        userId: 'user-123',
      });
      const transaction = transactionResult._unsafeUnwrap();

      const result = await transaction.finalize(mockCurrencyLookup);
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr()).toBeInstanceOf(EmptyTransactionError);
    });

    it('should fail to finalize unbalanced transaction', async () => {
      const transactionResult = LedgerTransaction.create({
        description: 'Bitcoin purchase',
        externalId: 'ext-456',
        source: 'kraken',
        userId: 'user-123',
      });
      const transaction = transactionResult._unsafeUnwrap();

      // Add unbalanced entries
      const debitMoney = Money.fromDecimal(100, 'USD', 2)._unsafeUnwrap();
      const creditMoney = Money.fromDecimal(-50, 'USD', 2)._unsafeUnwrap(); // Unbalanced!

      const debitEntry = Entry.create({ accountId: 1, amount: debitMoney })._unsafeUnwrap();
      const creditEntry = Entry.create({ accountId: 2, amount: creditMoney })._unsafeUnwrap();

      transaction.addEntry(debitEntry);
      transaction.addEntry(creditEntry);

      const result = await transaction.finalize(mockCurrencyLookup);
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr()).toBeInstanceOf(UnbalancedTransactionError);
    });

    it('should handle multi-currency balanced transaction', async () => {
      const transactionResult = LedgerTransaction.create({
        description: 'Multi-currency trade',
        externalId: 'ext-456',
        source: 'kraken',
        userId: 'user-123',
      });
      const transaction = transactionResult._unsafeUnwrap();

      // USD entries (balanced)
      const usdDebit = Money.fromDecimal(100, 'USD', 2)._unsafeUnwrap();
      const usdCredit = Money.fromDecimal(-100, 'USD', 2)._unsafeUnwrap();

      // BTC entries (balanced)
      const btcDebit = Money.fromDecimal(0.001, 'BTC', 8)._unsafeUnwrap();
      const btcCredit = Money.fromDecimal(-0.001, 'BTC', 8)._unsafeUnwrap();

      transaction.addEntry(Entry.create({ accountId: 1, amount: usdDebit })._unsafeUnwrap());
      transaction.addEntry(Entry.create({ accountId: 2, amount: usdCredit })._unsafeUnwrap());
      transaction.addEntry(Entry.create({ accountId: 3, amount: btcDebit })._unsafeUnwrap());
      transaction.addEntry(Entry.create({ accountId: 4, amount: btcCredit })._unsafeUnwrap());

      const result = await transaction.finalize(mockCurrencyLookup);
      expect(result.isOk()).toBe(true);
      expect(transaction.isBalanced()).toBe(true);
    });
  });

  describe('utility methods', () => {
    it('should get entries for specific currency', () => {
      const transactionResult = LedgerTransaction.create({
        description: 'Multi-currency trade',
        externalId: 'ext-456',
        source: 'kraken',
        userId: 'user-123',
      });
      const transaction = transactionResult._unsafeUnwrap();

      const usdEntry = Entry.create({
        accountId: 1,
        amount: Money.fromDecimal(100, 'USD', 2)._unsafeUnwrap(),
      })._unsafeUnwrap();
      const btcEntry = Entry.create({
        accountId: 2,
        amount: Money.fromDecimal(0.001, 'BTC', 8)._unsafeUnwrap(),
      })._unsafeUnwrap();

      transaction.addEntry(usdEntry);
      transaction.addEntry(btcEntry);

      const usdEntries = transaction.getEntriesForCurrency('USD');
      const btcEntries = transaction.getEntriesForCurrency('BTC');

      expect(usdEntries).toHaveLength(1);
      expect(btcEntries).toHaveLength(1);
      expect(usdEntries[0]).toBe(usdEntry);
      expect(btcEntries[0]).toBe(btcEntry);
    });

    it('should return correct state for persistence', () => {
      const transaction = LedgerTransaction.reconstitute(
        1,
        'user-123',
        'ext-456',
        'kraken',
        'Test transaction',
        [],
        TransactionState.FINALIZED,
        { test: true },
        new Date('2023-01-01'),
        new Date('2023-01-02')
      );

      const state = transaction.getState();
      expect(state.id).toBe(1);
      expect(state.userId).toBe('user-123');
      expect(state.externalId).toBe('ext-456');
      expect(state.state).toBe(TransactionState.FINALIZED);
      expect(state.metadata).toEqual({ test: true });
    });
  });
});
