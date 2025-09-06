import { describe, expect, it } from 'vitest';

import { Money } from '../../../value-objects/money/money.vo';
import { Entry } from '../entry.entity';
import { ZeroAmountEntryError, EntryCurrencyMismatchError } from '../entry.errors';

describe('Entry Entity', () => {
  describe('create', () => {
    it('should create valid entry with positive amount', () => {
      const moneyResult = Money.fromDecimal(100.5, 'USD', 2);
      expect(moneyResult.isOk()).toBe(true);
      const money = moneyResult._unsafeUnwrap();

      const result = Entry.create({
        accountId: 1,
        amount: money,
        description: 'Test entry',
      });

      expect(result.isOk()).toBe(true);
      const entry = result._unsafeUnwrap();
      expect(entry.accountId).toBe(1);
      expect(entry.amount).toBe(money);
      expect(entry.description).toBe('Test entry');
      expect(entry.isDebit()).toBe(true);
      expect(entry.isCredit()).toBe(false);
    });

    it('should create valid entry with negative amount', () => {
      const moneyResult = Money.fromDecimal(-50.25, 'USD', 2);
      expect(moneyResult.isOk()).toBe(true);
      const money = moneyResult._unsafeUnwrap();

      const result = Entry.create({
        accountId: 2,
        amount: money,
      });

      expect(result.isOk()).toBe(true);
      const entry = result._unsafeUnwrap();
      expect(entry.accountId).toBe(2);
      expect(entry.amount).toBe(money);
      expect(entry.description).toBe('');
      expect(entry.isDebit()).toBe(false);
      expect(entry.isCredit()).toBe(true);
    });

    it('should fail to create entry with zero amount', () => {
      const moneyResult = Money.fromDecimal(0, 'USD', 2);
      expect(moneyResult.isOk()).toBe(true);
      const money = moneyResult._unsafeUnwrap();

      const result = Entry.create({
        accountId: 1,
        amount: money,
      });

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr()).toBeInstanceOf(ZeroAmountEntryError);
    });

    it('should create entry with metadata', () => {
      const moneyResult = Money.fromDecimal(25.75, 'BTC', 8);
      expect(moneyResult.isOk()).toBe(true);
      const money = moneyResult._unsafeUnwrap();

      const metadata = { source: 'binance', txHash: '0x123' };
      const result = Entry.create({
        accountId: 3,
        amount: money,
        description: 'Bitcoin trade',
        metadata,
      });

      expect(result.isOk()).toBe(true);
      const entry = result._unsafeUnwrap();
      expect(entry.metadata).toEqual(metadata);
      expect(entry.metadata).not.toBe(metadata); // Should be a copy
    });
  });

  describe('reconstitute', () => {
    it('should reconstitute entry from database data', () => {
      const moneyResult = Money.fromDecimal(123.45, 'ETH', 18);
      expect(moneyResult.isOk()).toBe(true);
      const money = moneyResult._unsafeUnwrap();

      const createdAt = new Date('2023-01-01');
      const entry = Entry.reconstitute(5, 10, money, 'Reconstituted entry', { test: true }, createdAt);

      expect(entry.id).toBe(5);
      expect(entry.accountId).toBe(10);
      expect(entry.amount).toBe(money);
      expect(entry.description).toBe('Reconstituted entry');
      expect(entry.metadata).toEqual({ test: true });
      expect(entry.createdAt).toBe(createdAt);
    });
  });

  describe('currency validation', () => {
    it('should validate matching currency', () => {
      const moneyResult = Money.fromDecimal(100, 'USD', 2);
      expect(moneyResult.isOk()).toBe(true);
      const money = moneyResult._unsafeUnwrap();

      const entryResult = Entry.create({
        accountId: 1,
        amount: money,
      });
      expect(entryResult.isOk()).toBe(true);
      const entry = entryResult._unsafeUnwrap();

      const validationResult = entry.validateCurrency('USD');
      expect(validationResult.isOk()).toBe(true);
    });

    it('should fail validation for mismatched currency', () => {
      const moneyResult = Money.fromDecimal(100, 'USD', 2);
      expect(moneyResult.isOk()).toBe(true);
      const money = moneyResult._unsafeUnwrap();

      const entryResult = Entry.create({
        accountId: 1,
        amount: money,
      });
      expect(entryResult.isOk()).toBe(true);
      const entry = entryResult._unsafeUnwrap();

      const validationResult = entry.validateCurrency('EUR');
      expect(validationResult.isErr()).toBe(true);
      expect(validationResult._unsafeUnwrapErr()).toBeInstanceOf(EntryCurrencyMismatchError);
    });
  });

  describe('helper methods', () => {
    it('should return absolute amount', () => {
      const negativeMoneyResult = Money.fromDecimal(-75.25, 'USD', 2);
      expect(negativeMoneyResult.isOk()).toBe(true);
      const negativeMoney = negativeMoneyResult._unsafeUnwrap();

      const entryResult = Entry.create({
        accountId: 1,
        amount: negativeMoney,
      });
      expect(entryResult.isOk()).toBe(true);
      const entry = entryResult._unsafeUnwrap();

      const absoluteAmount = entry.getAbsoluteAmount();
      expect(absoluteAmount.isPositive()).toBe(true);
    });

    it('should return correct state for persistence', () => {
      const moneyResult = Money.fromDecimal(50.0, 'BTC', 8);
      expect(moneyResult.isOk()).toBe(true);
      const money = moneyResult._unsafeUnwrap();

      const entry = Entry.reconstitute(1, 2, money, 'Test description', { key: 'value' }, new Date('2023-01-01'));

      const state = entry.getState();
      expect(state).toEqual({
        accountId: 2,
        amount: money,
        createdAt: new Date('2023-01-01'),
        description: 'Test description',
        id: 1,
        metadata: { key: 'value' },
      });
    });
  });
});
