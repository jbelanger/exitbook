import { describe, expect, it } from 'vitest';

import type { SolanaTokenBalance } from '../types.js';
import {
  deduplicateTransactionsBySignature,
  extractAccountChanges,
  extractAccountChangesFromSolscan,
  extractTokenChanges,
  isValidSolanaAddress,
  lamportsToSol,
  solToLamports,
} from '../utils.js';

describe('utils', () => {
  describe('isValidSolanaAddress', () => {
    it('should validate correct Solana addresses', () => {
      expect(isValidSolanaAddress('DYw8jCTfwHNRJhhmFcbXvVDTqWMEVFBX6ZKUmG5CNSKK')).toBe(true);
      expect(isValidSolanaAddress('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')).toBe(true);
    });

    it('should reject invalid addresses', () => {
      expect(isValidSolanaAddress('invalid')).toBe(false);
      expect(isValidSolanaAddress('0x123')).toBe(false);
      expect(isValidSolanaAddress('')).toBe(false);
    });
  });

  describe('lamportsToSol', () => {
    it('should convert lamports to SOL', () => {
      expect(lamportsToSol(1000000000).toString()).toBe('1');
      expect(lamportsToSol(500000000).toString()).toBe('0.5');
      expect(lamportsToSol('1500000000').toString()).toBe('1.5');
    });
  });

  describe('solToLamports', () => {
    it('should convert SOL to lamports', () => {
      expect(solToLamports(1).toString()).toBe('1000000000');
      expect(solToLamports(0.5).toString()).toBe('500000000');
      expect(solToLamports('1.5').toString()).toBe('1500000000');
    });
  });

  describe('deduplicateTransactionsBySignature', () => {
    it('should deduplicate transactions by signature from transaction.signatures', () => {
      const transactions = [
        { transaction: { signatures: ['sig1'] }, data: 'tx1' },
        { transaction: { signatures: ['sig2'] }, data: 'tx2' },
        { transaction: { signatures: ['sig1'] }, data: 'tx1-duplicate' },
      ];

      const result = deduplicateTransactionsBySignature(transactions);

      expect(result.size).toBe(2);
      expect(result.get('sig1')).toEqual({ transaction: { signatures: ['sig1'] }, data: 'tx1' });
      expect(result.get('sig2')).toEqual({ transaction: { signatures: ['sig2'] }, data: 'tx2' });
    });

    it('should deduplicate transactions by signature field', () => {
      const transactions = [
        { signature: 'sig1', data: 'tx1' },
        { signature: 'sig2', data: 'tx2' },
        { signature: 'sig1', data: 'tx1-duplicate' },
      ];

      const result = deduplicateTransactionsBySignature(transactions);

      expect(result.size).toBe(2);
      expect(result.get('sig1')).toEqual({ signature: 'sig1', data: 'tx1' });
      expect(result.get('sig2')).toEqual({ signature: 'sig2', data: 'tx2' });
    });

    it('should handle mixed signature sources', () => {
      const transactions = [
        { transaction: { signatures: ['sig1'] }, data: 'tx1' },
        { signature: 'sig2', data: 'tx2' },
        { signature: 'sig1', data: 'tx1-duplicate' },
      ];

      const result = deduplicateTransactionsBySignature(transactions);

      expect(result.size).toBe(2);
      expect(result.get('sig1')).toEqual({ transaction: { signatures: ['sig1'] }, data: 'tx1' });
    });

    it('should skip transactions without signatures', () => {
      const transactions = [
        { transaction: { signatures: ['sig1'] }, data: 'tx1' },
        { data: 'no-sig' },
        { signature: undefined, data: 'undefined-sig' },
      ];

      const result = deduplicateTransactionsBySignature(transactions);

      expect(result.size).toBe(1);
      expect(result.get('sig1')).toEqual({ transaction: { signatures: ['sig1'] }, data: 'tx1' });
    });

    it('should handle empty array', () => {
      const result = deduplicateTransactionsBySignature([]);
      expect(result.size).toBe(0);
    });
  });

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
});
