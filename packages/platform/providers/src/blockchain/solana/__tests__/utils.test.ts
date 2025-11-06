import { describe, expect, it } from 'vitest';

import { deduplicateTransactionsBySignature, isValidSolanaAddress, lamportsToSol, solToLamports } from '../utils.js';

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
});
