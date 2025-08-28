import { describe, expect, it } from 'vitest';

import type { SnowtraceInternalTransaction, SnowtraceTokenTransfer, SnowtraceTransaction } from '../types.ts';
import { AvalancheUtils } from '../utils.ts';

describe('AvalancheUtils Correlation System', () => {
  const userAddress = '0x1234567890abcdef1234567890abcdef12345678';
  const otherAddress = '0xabcdef1234567890abcdef1234567890abcdef12';

  describe('groupTransactionsByHash', () => {
    it('should group transactions by hash correctly', () => {
      const normalTx: SnowtraceTransaction = {
        blockHash: '0xblock1',
        blockNumber: '1000000',
        confirmations: '10',
        cumulativeGasUsed: '21000',
        from: userAddress,
        gas: '21000',
        gasPrice: '25000000000',
        gasUsed: '21000',
        hash: '0xhash1',
        input: '0x',
        nonce: '1',
        timeStamp: '1640000000',
        to: otherAddress,
        transactionIndex: '0',
        value: '100000000000000000', // 0.1 AVAX
      };

      const tokenTx: SnowtraceTokenTransfer = {
        blockHash: '0xblock1',
        blockNumber: '1000000',
        confirmations: '10',
        contractAddress: '0xusdccontract',
        cumulativeGasUsed: '50000',
        from: userAddress,
        gas: '100000',
        gasPrice: '25000000000',
        gasUsed: '50000',
        hash: '0xhash1', // Same hash
        input: '0xdata',
        nonce: '1',
        timeStamp: '1640000000',
        to: otherAddress,
        tokenDecimal: '6',
        tokenName: 'USD Coin',
        tokenSymbol: 'USDC',
        transactionIndex: '0',
        value: '400000000', // 400 USDC (6 decimals)
      };

      const groups = AvalancheUtils.groupTransactionsByHash([normalTx], [], [tokenTx], userAddress);

      expect(groups).toHaveLength(1);
      expect(groups[0].hash).toBe('0xhash1');
      expect(groups[0].normal).toEqual(normalTx);
      expect(groups[0].tokens).toHaveLength(1);
      expect(groups[0].tokens![0]).toEqual(tokenTx);
      expect(groups[0].internal).toHaveLength(0);
    });

    it('should create separate groups for different hashes', () => {
      const normalTx1: SnowtraceTransaction = {
        blockHash: '0xblock1',
        blockNumber: '1000000',
        confirmations: '10',
        cumulativeGasUsed: '21000',
        from: userAddress,
        gas: '21000',
        gasPrice: '25000000000',
        gasUsed: '21000',
        hash: '0xhash1',
        input: '0x',
        nonce: '1',
        timeStamp: '1640000000',
        to: otherAddress,
        transactionIndex: '0',
        value: '100000000000000000',
      };

      const normalTx2: SnowtraceTransaction = {
        blockHash: '0xblock2',
        blockNumber: '1000001',
        confirmations: '9',
        cumulativeGasUsed: '21000',
        from: userAddress,
        gas: '21000',
        gasPrice: '25000000000',
        gasUsed: '21000',
        hash: '0xhash2',
        input: '0x',
        nonce: '2',
        timeStamp: '1640000001',
        to: otherAddress,
        transactionIndex: '0',
        value: '200000000000000000',
      };

      const groups = AvalancheUtils.groupTransactionsByHash([normalTx1, normalTx2], [], [], userAddress);

      expect(groups).toHaveLength(2);
      expect(groups.find(g => g.hash === '0xhash1')).toBeDefined();
      expect(groups.find(g => g.hash === '0xhash2')).toBeDefined();
    });
  });

  describe('classifyTransactionGroup', () => {
    it('should classify token withdrawal correctly', () => {
      const group = {
        hash: '0xhash1',
        timestamp: 1640000000000,
        tokens: [
          {
            blockHash: '0xblock1',
            blockNumber: '1000000',
            confirmations: '10',
            contractAddress: '0xusdccontract',
            cumulativeGasUsed: '50000',
            from: userAddress, // User sending tokens = withdrawal
            gas: '100000',
            gasPrice: '25000000000',
            gasUsed: '50000',
            hash: '0xhash1',
            input: '0xdata',
            nonce: '1',
            timeStamp: '1640000000',
            to: otherAddress,
            tokenDecimal: '6',
            tokenName: 'USD Coin',
            tokenSymbol: 'USDC',
            transactionIndex: '0',
            value: '400000000', // 400 USDC
          },
        ],
        userAddress,
      };

      const result = AvalancheUtils.classifyTransactionGroup(group);

      expect(result.type).toBe('withdrawal');
      expect(result.primarySymbol).toBe('USDC');
      expect(result.primaryAmount).toBe('400');
      expect(result.assets).toHaveLength(1);
      expect(result.assets[0].direction).toBe('out');
      expect(result.reason).toContain('Net outflow');
    });

    it('should classify token deposit correctly', () => {
      const group = {
        hash: '0xhash1',
        timestamp: 1640000000000,
        tokens: [
          {
            blockHash: '0xblock1',
            blockNumber: '1000000',
            confirmations: '10',
            contractAddress: '0xusdccontract',
            cumulativeGasUsed: '50000',
            from: otherAddress,
            gas: '100000',
            gasPrice: '25000000000',
            gasUsed: '50000',
            hash: '0xhash1',
            input: '0xdata',
            nonce: '1',
            timeStamp: '1640000000',
            to: userAddress, // User receiving tokens = deposit
            tokenDecimal: '6',
            tokenName: 'USD Coin',
            tokenSymbol: 'USDC',
            transactionIndex: '0',
            value: '500000000', // 500 USDC
          },
        ],
        userAddress,
      };

      const result = AvalancheUtils.classifyTransactionGroup(group);

      expect(result.type).toBe('deposit');
      expect(result.primarySymbol).toBe('USDC');
      expect(result.primaryAmount).toBe('500');
      expect(result.assets).toHaveLength(1);
      expect(result.assets[0].direction).toBe('in');
      expect(result.reason).toContain('Net inflow');
    });

    it('should classify AVAX withdrawal from internal transaction', () => {
      const group = {
        hash: '0xhash1',
        internal: [
          {
            blockNumber: '1000000',
            contractAddress: '0xcontract',
            errCode: '',
            from: userAddress, // User sending AVAX = withdrawal
            gas: '21000',
            gasUsed: '21000',
            hash: '0xhash1',
            input: '0x',
            isError: '0',
            timeStamp: '1640000000',
            to: otherAddress,
            traceId: '0',
            type: 'call',
            value: '1000000000000000000', // 1 AVAX
          },
        ],
        timestamp: 1640000000000,
        userAddress,
      };

      const result = AvalancheUtils.classifyTransactionGroup(group);

      expect(result.type).toBe('withdrawal');
      expect(result.primarySymbol).toBe('AVAX');
      expect(result.primaryAmount).toBe('1');
      expect(result.assets).toHaveLength(1);
      expect(result.assets[0].direction).toBe('out');
    });

    it('should prioritize token transfers over AVAX movements', () => {
      const group = {
        hash: '0xhash1',
        normal: {
          blockHash: '0xblock1',
          blockNumber: '1000000',
          confirmations: '10',
          cumulativeGasUsed: '21000',
          from: userAddress,
          gas: '21000',
          gasPrice: '25000000000',
          gasUsed: '21000',
          hash: '0xhash1',
          input: '0x',
          nonce: '1',
          timeStamp: '1640000000',
          to: otherAddress,
          transactionIndex: '0',
          value: '100000000000000000', // 0.1 AVAX
        },
        timestamp: 1640000000000,
        tokens: [
          {
            blockHash: '0xblock1',
            blockNumber: '1000000',
            confirmations: '10',
            contractAddress: '0xusdccontract',
            cumulativeGasUsed: '50000',
            from: userAddress,
            gas: '100000',
            gasPrice: '25000000000',
            gasUsed: '50000',
            hash: '0xhash1',
            input: '0xdata',
            nonce: '1',
            timeStamp: '1640000000',
            to: otherAddress,
            tokenDecimal: '6',
            tokenName: 'USD Coin',
            tokenSymbol: 'USDC',
            transactionIndex: '0',
            value: '400000000', // 400 USDC - this should be primary
          },
        ],
        userAddress,
      };

      const result = AvalancheUtils.classifyTransactionGroup(group);

      expect(result.type).toBe('withdrawal');
      expect(result.primarySymbol).toBe('USDC'); // Token should be primary, not AVAX
      expect(result.primaryAmount).toBe('400');
    });

    it('should handle complex multi-token transactions', () => {
      const group = {
        hash: '0xhash1',
        timestamp: 1640000000000,
        tokens: [
          {
            blockHash: '0xblock1',
            blockNumber: '1000000',
            confirmations: '10',
            contractAddress: '0xusdccontract',
            cumulativeGasUsed: '50000',
            from: userAddress,
            gas: '100000',
            gasPrice: '25000000000',
            gasUsed: '50000',
            hash: '0xhash1',
            input: '0xdata',
            nonce: '1',
            timeStamp: '1640000000',
            to: otherAddress,
            tokenDecimal: '6',
            tokenName: 'USD Coin',
            tokenSymbol: 'USDC',
            transactionIndex: '0',
            value: '400000000', // 400 USDC out
          },
          {
            blockHash: '0xblock1',
            blockNumber: '1000000',
            confirmations: '10',
            contractAddress: '0xwethcontract',
            cumulativeGasUsed: '50000',
            from: otherAddress,
            gas: '100000',
            gasPrice: '25000000000',
            gasUsed: '50000',
            hash: '0xhash1',
            input: '0xdata',
            nonce: '1',
            timeStamp: '1640000000',
            to: userAddress,
            tokenDecimal: '18',
            tokenName: 'Wrapped Ethereum',
            tokenSymbol: 'WETH',
            transactionIndex: '0',
            value: '1000000000000000000', // 1 WETH in
          },
        ],
        userAddress,
      };

      const result = AvalancheUtils.classifyTransactionGroup(group);

      // Should classify based on the largest value flow
      expect(result.assets).toHaveLength(2);
      expect(result.assets.find(a => a.symbol === 'USDC')?.direction).toBe('out');
      expect(result.assets.find(a => a.symbol === 'WETH')?.direction).toBe('in');
    });

    it('should handle zero value transactions gracefully', () => {
      const group = {
        hash: '0xhash1',
        normal: {
          blockHash: '0xblock1',
          blockNumber: '1000000',
          confirmations: '10',
          cumulativeGasUsed: '21000',
          from: userAddress,
          gas: '21000',
          gasPrice: '25000000000',
          gasUsed: '21000',
          hash: '0xhash1',
          input: '0xdata', // Contract call
          nonce: '1',
          timeStamp: '1640000000',
          to: otherAddress,
          transactionIndex: '0',
          value: '0', // Zero value
        },
        timestamp: 1640000000000,
        userAddress,
      };

      const result = AvalancheUtils.classifyTransactionGroup(group);

      expect(result.type).toBe('transfer');
      expect(result.primaryAmount).toBe('0');
      expect(result.reason).toContain('No value flows detected');
    });

    it('should correctly classify problematic transaction 0xb897280288b912a125426a520b7d0dc78bd93184e8374faf7c2fd9bfee5a2a1d as withdrawal', () => {
      // This represents the problematic transaction from the GitHub issue
      // The transaction should be classified as withdrawal because the user sent 400 USDC tokens
      const group = {
        hash: '0xb897280288b912a125426a520b7d0dc78bd93184e8374faf7c2fd9bfee5a2a1d',
        normal: {
          blockHash: '0xblock1',
          blockNumber: '1000000',
          confirmations: '10',
          cumulativeGasUsed: '50000',
          from: userAddress,
          gas: '100000',
          gasPrice: '25000000000',
          gasUsed: '50000',
          // Normal transaction shows contract interaction but no AVAX transfer
          hash: '0xb897280288b912a125426a520b7d0dc78bd93184e8374faf7c2fd9bfee5a2a1d',
          input: '0xa9059cbb000000000000000000000000...', // Contract call data
          nonce: '1',
          timeStamp: '1640000000',
          to: '0xa7d7079b0fead91f3e65f86e8915cb59c1a4c664', // Contract address
          transactionIndex: '0',
          value: '0', // No AVAX value
        },
        timestamp: 1640000000000,
        tokens: [
          {
            blockHash: '0xblock1',
            blockNumber: '1000000',
            confirmations: '10',
            contractAddress: '0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e',
            cumulativeGasUsed: '50000',
            from: userAddress, // USER IS SENDER - this makes it a withdrawal
            gas: '100000',
            gasPrice: '25000000000',
            gasUsed: '50000',
            // This is the key data - user is sending 400 USDC tokens
            hash: '0xb897280288b912a125426a520b7d0dc78bd93184e8374faf7c2fd9bfee5a2a1d',
            input: '0x',
            nonce: '1',
            timeStamp: '1640000000',
            to: '0x9876543210abcdef9876543210abcdef98765432', // Recipient
            tokenDecimal: '6',
            tokenName: 'USD Coin',
            tokenSymbol: 'USDC',
            transactionIndex: '0',
            value: '400000000', // 400 USDC (6 decimals)
          },
        ],
        userAddress,
      };

      const result = AvalancheUtils.classifyTransactionGroup(group);

      // The key assertion: this should be classified as withdrawal, not deposit
      expect(result.type).toBe('withdrawal');
      expect(result.primarySymbol).toBe('USDC');
      expect(result.primaryAmount).toBe('400');
      expect(result.assets).toHaveLength(1);
      expect(result.assets[0]).toEqual({
        amount: '400',
        direction: 'out',
        symbol: 'USDC',
      });
      expect(result.reason).toContain('Net outflow of 400 USDC');
    });
  });
});
