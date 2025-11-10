import { describe, expect, it } from 'vitest';

import { generateUniqueTransactionId, type TransactionIdFields } from '../transaction-utils.js';

describe('transaction-utils', () => {
  describe('generateUniqueTransactionId', () => {
    it('should generate deterministic hash from basic transaction fields', () => {
      const tx: TransactionIdFields = {
        id: '0xabc123',
        from: '0x1234567890123456789012345678901234567890',
        to: '0x0987654321098765432109876543210987654321',
        currency: 'ETH',
        amount: '1000000000000000000',
        timestamp: 1234567890,
        type: 'transfer',
      };

      const externalId1 = generateUniqueTransactionId(tx);
      const externalId2 = generateUniqueTransactionId(tx);

      expect(externalId1).toBe(externalId2);
      expect(externalId1).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should generate different hashes for different transactions', () => {
      const tx1: TransactionIdFields = {
        id: '0xabc123',
        from: '0x1234567890123456789012345678901234567890',
        to: '0x0987654321098765432109876543210987654321',
        currency: 'ETH',
        amount: '1000000000000000000',
        timestamp: 1234567890,
        type: 'transfer',
      };

      const tx2: TransactionIdFields = {
        ...tx1,
        amount: '2000000000000000000', // Different amount
      };

      const externalId1 = generateUniqueTransactionId(tx1);
      const externalId2 = generateUniqueTransactionId(tx2);

      expect(externalId1).not.toBe(externalId2);
    });

    it('should normalize addresses to lowercase', () => {
      const tx1: TransactionIdFields = {
        id: '0xabc123',
        from: '0xABCDEF1234567890123456789012345678901234',
        to: '0x0987654321098765432109876543210987654321',
        currency: 'ETH',
        amount: '1000000000000000000',
        timestamp: 1234567890,
        type: 'transfer',
      };

      const tx2: TransactionIdFields = {
        ...tx1,
        from: '0xabcdef1234567890123456789012345678901234', // Lowercase version
      };

      const externalId1 = generateUniqueTransactionId(tx1);
      const externalId2 = generateUniqueTransactionId(tx2);

      expect(externalId1).toBe(externalId2);
    });

    it('should handle missing to address', () => {
      const tx: TransactionIdFields = {
        id: '0xabc123',
        from: '0x1234567890123456789012345678901234567890',
        currency: 'ETH',
        amount: '1000000000000000000',
        timestamp: 1234567890,
        type: 'transfer',
      };

      const externalId = generateUniqueTransactionId(tx);
      expect(externalId).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should differentiate token transfers by token address', () => {
      const baseTx: TransactionIdFields = {
        id: '0xabc123',
        from: '0x1234567890123456789012345678901234567890',
        to: '0x0987654321098765432109876543210987654321',
        currency: 'USDT',
        amount: '1000000',
        timestamp: 1234567890,
        type: 'token_transfer',
      };

      const tx1: TransactionIdFields = {
        ...baseTx,
        tokenAddress: '0xdac17f958d2ee523a2206206994597c13d831ec7', // USDT
      };

      const tx2: TransactionIdFields = {
        ...baseTx,
        tokenAddress: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', // USDC
      };

      const externalId1 = generateUniqueTransactionId(tx1);
      const externalId2 = generateUniqueTransactionId(tx2);

      expect(externalId1).not.toBe(externalId2);
    });

    it('should differentiate internal transactions by traceId', () => {
      const baseTx: TransactionIdFields = {
        id: '0xabc123',
        from: '0x1234567890123456789012345678901234567890',
        to: '0x0987654321098765432109876543210987654321',
        currency: 'ETH',
        amount: '1000000000000000000',
        timestamp: 1234567890,
        type: 'internal',
      };

      const tx1: TransactionIdFields = {
        ...baseTx,
        traceId: 'trace-0',
      };

      const tx2: TransactionIdFields = {
        ...baseTx,
        traceId: 'trace-1',
      };

      const externalId1 = generateUniqueTransactionId(tx1);
      const externalId2 = generateUniqueTransactionId(tx2);

      expect(externalId1).not.toBe(externalId2);
    });

    it('should handle internal transaction without traceId', () => {
      const tx: TransactionIdFields = {
        id: '0xabc123',
        from: '0x1234567890123456789012345678901234567890',
        to: '0x0987654321098765432109876543210987654321',
        currency: 'ETH',
        amount: '1000000000000000000',
        timestamp: 1234567890,
        type: 'internal',
      };

      const externalId = generateUniqueTransactionId(tx);
      expect(externalId).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe('generateEvmExternalId', () => {
    it('should generate deterministic hash for EVM transaction', () => {
      const tx = {
        id: '0xabc123',
        from: '0x1234567890123456789012345678901234567890',
        to: '0x0987654321098765432109876543210987654321',
        currency: 'ETH',
        amount: '1000000000000000000',
        timestamp: 1234567890,
        type: 'transfer',
        status: 'success',
        providerName: 'alchemy',
      };

      const externalId1 = generateUniqueTransactionId(tx);
      const externalId2 = generateUniqueTransactionId(tx);

      expect(externalId1).toBe(externalId2);
      expect(externalId1).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should differentiate token transfers by token address', () => {
      const baseTx = {
        id: '0xabc123',
        from: '0x1234567890123456789012345678901234567890',
        to: '0x0987654321098765432109876543210987654321',
        currency: 'USDT',
        amount: '1000000',
        timestamp: 1234567890,
        type: 'token_transfer',
        status: 'success',
        providerName: 'alchemy',
      };

      const tx1 = {
        ...baseTx,
        tokenAddress: '0xdac17f958d2ee523a2206206994597c13d831ec7', // USDT
      };

      const tx2 = {
        ...baseTx,
        tokenAddress: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', // USDC
      };

      const externalId1 = generateUniqueTransactionId(tx1);
      const externalId2 = generateUniqueTransactionId(tx2);

      expect(externalId1).not.toBe(externalId2);
    });
  });

  describe('cross-chain compatibility', () => {
    it('should work with Bitcoin transaction structure', () => {
      const btcTx = {
        id: 'abc123def456',
        currency: 'BTC',
        timestamp: 1234567890,
        status: 'success',
        providerName: 'blockstream',
        inputs: [
          {
            address: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
            value: '100000000',
          },
        ],
        outputs: [
          {
            address: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq',
            value: '50000000',
            index: 0,
          },
        ],
      };

      const externalId = generateUniqueTransactionId({
        id: btcTx.id,
        from: btcTx.inputs[0]?.address || '',
        to: btcTx.outputs[0]?.address,
        currency: btcTx.currency,
        amount: btcTx.outputs[0]?.value || '0',
        timestamp: btcTx.timestamp,
        type: 'transfer',
      });

      expect(externalId).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should work with Solana transaction structure', () => {
      const solTx = {
        id: '5QxYZ123...',
        from: 'DYw8jCTfwHNRJhhmFcbXvVDTqWMEVFBX6ZKUmG5CNSKK',
        to: 'FUarP2p5EnxD66vVDL4PWRoWMzA56ZVHG24hpEDFShEz',
        currency: 'SOL',
        amount: '1000000000',
        timestamp: 1234567890,
        status: 'success',
        providerName: 'helius',
      };

      const externalId = generateUniqueTransactionId({
        ...solTx,
        type: 'transfer',
      });

      expect(externalId).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should work with Substrate transaction structure', () => {
      const dotTx = {
        id: '0xabc123-456',
        from: '15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5',
        to: '14Gjs1TD93gnwEBfDMHoCgsuf1s2TVKUP6Z1qKmAZnZ8cW5q',
        currency: 'DOT',
        amount: '1000000000000',
        timestamp: 1234567890,
        status: 'success',
        providerName: 'subscan',
      };

      const externalId = generateUniqueTransactionId({
        ...dotTx,
        type: 'transfer',
      });

      expect(externalId).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should work with Cosmos transaction structure', () => {
      const injTx = {
        id: 'ABC123DEF456',
        from: 'inj1abc123...',
        to: 'inj1def456...',
        currency: 'INJ',
        amount: '1000000000000000000',
        timestamp: 1234567890,
        status: 'success',
        providerName: 'injective-explorer',
      };

      const externalId = generateUniqueTransactionId({
        ...injTx,
        type: 'transfer',
      });

      expect(externalId).toMatch(/^[a-f0-9]{64}$/);
    });
  });
});
