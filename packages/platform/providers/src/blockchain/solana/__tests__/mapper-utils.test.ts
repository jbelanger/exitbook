import { describe, expect, it } from 'vitest';

import {
  determinePrimaryTransfer,
  determineRecipient,
  extractAccountChanges,
  extractAccountChangesFromSolscan,
  extractTokenChanges,
} from '../mapper-utils.js';
import type { SolanaTokenBalance } from '../types.js';

describe('mapper-utils', () => {
  describe('extractAccountChanges', () => {
    it('should extract accounts with balance changes', () => {
      const preBalances = [1000000000, 2000000000, 3000000000];
      const postBalances = [900000000, 2000000000, 3100000000];
      const accountKeys = ['addr1', 'addr2', 'addr3'];

      const result = extractAccountChanges(preBalances, postBalances, accountKeys);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        account: 'addr1',
        preBalance: '1000000000',
        postBalance: '900000000',
      });
      expect(result[1]).toEqual({
        account: 'addr3',
        preBalance: '3000000000',
        postBalance: '3100000000',
      });
    });

    it('should handle empty arrays', () => {
      const result = extractAccountChanges([], [], []);
      expect(result).toHaveLength(0);
    });

    it('should skip accounts without changes', () => {
      const preBalances = [1000000000, 2000000000];
      const postBalances = [1000000000, 2000000000];
      const accountKeys = ['addr1', 'addr2'];

      const result = extractAccountChanges(preBalances, postBalances, accountKeys);
      expect(result).toHaveLength(0);
    });
  });

  describe('extractAccountChangesFromSolscan', () => {
    it('should extract accounts with balance changes from Solscan structure', () => {
      const inputAccount = [
        { account: 'addr1', preBalance: 1000000000, postBalance: 900000000 },
        { account: 'addr2', preBalance: 2000000000, postBalance: 2000000000 },
        { account: 'addr3', preBalance: 3000000000, postBalance: 3100000000 },
      ];

      const result = extractAccountChangesFromSolscan(inputAccount);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        account: 'addr1',
        preBalance: '1000000000',
        postBalance: '900000000',
      });
      expect(result[1]).toEqual({
        account: 'addr3',
        preBalance: '3000000000',
        postBalance: '3100000000',
      });
    });
  });

  describe('extractTokenChanges', () => {
    it('should detect token balance changes', () => {
      const preTokenBalances: SolanaTokenBalance[] = [
        {
          accountIndex: 0,
          mint: 'token1',
          owner: 'owner1',
          uiTokenAmount: {
            amount: '1000',
            decimals: 9,
            uiAmount: 0.000001,
            uiAmountString: '0.000001',
          },
        },
      ];

      const postTokenBalances: SolanaTokenBalance[] = [
        {
          accountIndex: 0,
          mint: 'token1',
          owner: 'owner1',
          uiTokenAmount: {
            amount: '2000',
            decimals: 9,
            uiAmount: 0.000002,
            uiAmountString: '0.000002',
          },
        },
      ];

      const result = extractTokenChanges(preTokenBalances, postTokenBalances, true);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        account: 'owner1',
        decimals: 9,
        mint: 'token1',
        owner: 'owner1',
        preAmount: '1000',
        postAmount: '2000',
        symbol: 'token1',
      });
    });

    it('should detect fully spent tokens', () => {
      const preTokenBalances: SolanaTokenBalance[] = [
        {
          accountIndex: 0,
          mint: 'token1',
          owner: 'owner1',
          uiTokenAmount: {
            amount: '1000',
            decimals: 9,
            uiAmount: 0.000001,
            uiAmountString: '0.000001',
          },
        },
      ];

      const postTokenBalances: SolanaTokenBalance[] = [];

      const result = extractTokenChanges(preTokenBalances, postTokenBalances, false);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        account: 'owner1',
        decimals: 9,
        mint: 'token1',
        owner: 'owner1',
        preAmount: '1000',
        postAmount: '0',
      });
    });

    it('should skip tokens without changes', () => {
      const preTokenBalances: SolanaTokenBalance[] = [
        {
          accountIndex: 0,
          mint: 'token1',
          owner: 'owner1',
          uiTokenAmount: {
            amount: '1000',
            decimals: 9,
            uiAmount: 0.000001,
            uiAmountString: '0.000001',
          },
        },
      ];

      const postTokenBalances: SolanaTokenBalance[] = [
        {
          accountIndex: 0,
          mint: 'token1',
          owner: 'owner1',
          uiTokenAmount: {
            amount: '1000',
            decimals: 9,
            uiAmount: 0.000001,
            uiAmountString: '0.000001',
          },
        },
      ];

      const result = extractTokenChanges(preTokenBalances, postTokenBalances, true);
      expect(result).toHaveLength(0);
    });
  });

  describe('determinePrimaryTransfer', () => {
    it('should prioritize token changes over SOL changes', () => {
      const accountChanges = [
        { account: 'addr1', preBalance: '1000000000', postBalance: '900000000' },
        { account: 'addr2', preBalance: '2000000000', postBalance: '2100000000' },
      ];

      const tokenChanges = [
        {
          account: 'owner1',
          decimals: 9,
          mint: 'token1',
          owner: 'owner1',
          preAmount: '1000',
          postAmount: '2000',
          symbol: 'USDC',
        },
      ];

      const result = determinePrimaryTransfer(accountChanges, tokenChanges);

      expect(result).toEqual({
        primaryAmount: '1000',
        primaryCurrency: 'USDC',
      });
    });

    it('should use largest SOL change when no token changes', () => {
      const accountChanges = [
        { account: 'addr1', preBalance: '1000000000', postBalance: '900000000' },
        { account: 'addr2', preBalance: '2000000000', postBalance: '2500000000' },
      ];

      const result = determinePrimaryTransfer(accountChanges, []);

      expect(result).toEqual({
        primaryAmount: '500000000',
        primaryCurrency: 'SOL',
      });
    });

    it('should default to zero SOL when no changes', () => {
      const result = determinePrimaryTransfer([], []);

      expect(result).toEqual({
        primaryAmount: '0',
        primaryCurrency: 'SOL',
      });
    });

    it('should handle single account change (fee-only transaction)', () => {
      const accountChanges = [{ account: 'addr1', preBalance: '1000000000', postBalance: '999995000' }];

      const result = determinePrimaryTransfer(accountChanges, []);

      expect(result).toEqual({
        primaryAmount: '5000',
        primaryCurrency: 'SOL',
      });
    });
  });

  describe('determineRecipient', () => {
    it('should find account with positive balance change', () => {
      const inputAccount = [
        { account: 'addr1', preBalance: 1000000000, postBalance: 900000000 },
        { account: 'addr2', preBalance: 2000000000, postBalance: 2100000000 },
      ];

      const result = determineRecipient(inputAccount, 'addr1');

      expect(result).toBe('addr2');
    });

    it('should exclude fee payer account', () => {
      const inputAccount = [
        { account: 'addr1', preBalance: 1000000000, postBalance: 1100000000 },
        { account: 'addr2', preBalance: 2000000000, postBalance: 2100000000 },
      ];

      const result = determineRecipient(inputAccount, 'addr1');

      expect(result).toBe('addr2');
    });

    it('should return empty string when no recipient found', () => {
      const inputAccount = [{ account: 'addr1', preBalance: 1000000000, postBalance: 900000000 }];

      const result = determineRecipient(inputAccount, 'addr1');

      expect(result).toBe('');
    });
  });
});
