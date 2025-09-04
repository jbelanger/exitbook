import { describe, expect, it } from 'vitest';

import { ValidationError, RequiredFieldError, InvalidFormatError } from '../../../errors/domain-errors';
import { Account, AccountType, CreateAccountData } from '../account.aggregate';

describe('Account Aggregate', () => {
  const validAccountData: CreateAccountData = {
    currencyTicker: 'BTC',
    identifier: 'bc1qxy...',
    metadata: { exchange: 'coinbase' },
    name: 'Bitcoin Wallet',
    source: 'coinbase',
    type: AccountType.ASSET_WALLET,
    userId: 'user-123',
  };

  describe('create', () => {
    it('should create a valid account', () => {
      const result = Account.create(validAccountData);

      expect(result.isOk()).toBe(true);
      const account = result._unsafeUnwrap();
      expect(account.userId).toBe('user-123');
      expect(account.name).toBe('Bitcoin Wallet');
      expect(account.type).toBe(AccountType.ASSET_WALLET);
      expect(account.currencyTicker).toBe('BTC');
      expect(account.source).toBe('coinbase');
      expect(account.identifier).toBe('bc1qxy...');
    });

    it('should normalize currency ticker to uppercase', () => {
      const data = { ...validAccountData, currencyTicker: 'btc' };
      const result = Account.create(data);

      expect(result.isOk()).toBe(true);
      const account = result._unsafeUnwrap();
      expect(account.currencyTicker).toBe('BTC');
    });

    it('should fail with empty userId', () => {
      const data = { ...validAccountData, userId: '' };
      const result = Account.create(data);

      expect(result.isErr()).toBe(true);
      const error = result._unsafeUnwrapErr();
      expect(error).toBeInstanceOf(RequiredFieldError);
      expect(error.message).toContain('userId is required');
    });

    it('should fail with empty name', () => {
      const data = { ...validAccountData, name: '' };
      const result = Account.create(data);

      expect(result.isErr()).toBe(true);
      const error = result._unsafeUnwrapErr();
      expect(error).toBeInstanceOf(RequiredFieldError);
      expect(error.message).toContain('name is required');
    });

    it('should fail with invalid account type', () => {
      const data = { ...validAccountData, type: 'INVALID_TYPE' as AccountType };
      const result = Account.create(data);

      expect(result.isErr()).toBe(true);
      const error = result._unsafeUnwrapErr();
      expect(error).toBeInstanceOf(InvalidFormatError);
      expect(error.message).toContain('must be a valid one of:');
    });
  });

  describe('account type checks', () => {
    it('should identify asset accounts correctly', () => {
      const walletResult = Account.create({ ...validAccountData, type: AccountType.ASSET_WALLET });
      const exchangeResult = Account.create({ ...validAccountData, type: AccountType.ASSET_EXCHANGE });
      const lpResult = Account.create({ ...validAccountData, type: AccountType.ASSET_DEFI_LP });

      expect(walletResult._unsafeUnwrap().isAsset()).toBe(true);
      expect(exchangeResult._unsafeUnwrap().isAsset()).toBe(true);
      expect(lpResult._unsafeUnwrap().isAsset()).toBe(true);
    });

    it('should identify income accounts correctly', () => {
      const stakingResult = Account.create({ ...validAccountData, type: AccountType.INCOME_STAKING });
      const tradingResult = Account.create({ ...validAccountData, type: AccountType.INCOME_TRADING });

      expect(stakingResult._unsafeUnwrap().isIncome()).toBe(true);
      expect(tradingResult._unsafeUnwrap().isIncome()).toBe(true);
    });

    it('should identify expense accounts correctly', () => {
      const gasResult = Account.create({ ...validAccountData, type: AccountType.EXPENSE_FEES_GAS });
      const tradeResult = Account.create({ ...validAccountData, type: AccountType.EXPENSE_FEES_TRADE });

      expect(gasResult._unsafeUnwrap().isExpense()).toBe(true);
      expect(tradeResult._unsafeUnwrap().isExpense()).toBe(true);
    });

    it('should return correct broad categories', () => {
      const assetAccount = Account.create({ ...validAccountData, type: AccountType.ASSET_WALLET })._unsafeUnwrap();
      const incomeAccount = Account.create({ ...validAccountData, type: AccountType.INCOME_STAKING })._unsafeUnwrap();
      const expenseAccount = Account.create({
        ...validAccountData,
        type: AccountType.EXPENSE_FEES_GAS,
      })._unsafeUnwrap();

      expect(assetAccount.getBroadCategory()).toBe('ASSET');
      expect(incomeAccount.getBroadCategory()).toBe('INCOME');
      expect(expenseAccount.getBroadCategory()).toBe('EXPENSE');
    });
  });

  describe('utility methods', () => {
    it('should generate correct unique key', () => {
      const account = Account.create(validAccountData)._unsafeUnwrap();
      expect(account.getUniqueKey()).toBe('BTC-coinbase');
    });

    it('should match currency and source correctly', () => {
      const account = Account.create(validAccountData)._unsafeUnwrap();
      expect(account.matches('BTC', 'coinbase')).toBe(true);
      expect(account.matches('btc', 'coinbase')).toBe(true); // Case insensitive
      expect(account.matches('ETH', 'coinbase')).toBe(false);
      expect(account.matches('BTC', 'binance')).toBe(false);
    });

    it('should return correct state for persistence', () => {
      const account = Account.create(validAccountData)._unsafeUnwrap();
      const state = account.getState();

      expect(state.userId).toBe('user-123');
      expect(state.name).toBe('Bitcoin Wallet');
      expect(state.type).toBe(AccountType.ASSET_WALLET);
      expect(state.currencyTicker).toBe('BTC');
      expect(state.source).toBe('coinbase');
      expect(state.metadata).toEqual({ exchange: 'coinbase' });
    });
  });

  describe('reconstitute', () => {
    it('should reconstitute account from database data', () => {
      const now = new Date();
      const account = Account.reconstitute(
        1,
        'user-123',
        'Bitcoin Wallet',
        AccountType.ASSET_WALLET,
        'BTC',
        'coinbase',
        'bc1qxy...',
        { exchange: 'coinbase' },
        now,
        now
      );

      expect(account.id).toBe(1);
      expect(account.userId).toBe('user-123');
      expect(account.name).toBe('Bitcoin Wallet');
      expect(account.type).toBe(AccountType.ASSET_WALLET);
      expect(account.currencyTicker).toBe('BTC');
      expect(account.source).toBe('coinbase');
    });
  });
});
