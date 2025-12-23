import { describe, expect, it } from 'vitest';

import { mapThetaExplorerTransaction } from '../theta-explorer.mapper-utils.js';
import type { ThetaTransaction, ThetaSendTransactionData } from '../theta-explorer.schemas.js';

describe.skip('ThetaExplorerTransactionMapper', () => {
  describe('THETA currency detection', () => {
    it('should map THETA transfer with correct currency and type', () => {
      const rawTx: ThetaTransaction = {
        block_height: '30599571',
        data: {
          inputs: [
            {
              address: '0x6d882a1ae65377c12e8c1ad5a8b5cfa329edeb07',
              coins: { tfuelwei: '0', thetawei: '500000000000000000000' },
            },
          ],
          outputs: [
            {
              address: '0x3b2cf117129bb01c47d51557e6efdbe3ae3637c4',
              coins: { tfuelwei: '0', thetawei: '420333700000000000000' },
            },
          ],
        } as ThetaSendTransactionData,
        hash: '0xa8e2051371ac9307a54e5290ec522d679bd7ecde13b86fd85a5d6acbe3257a3a',
        timestamp: new Date(1752686427 * 1000),
        type: 2,
      };

      const result = mapThetaExplorerTransaction(rawTx);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const normalized = result.value;
        expect(normalized.currency).toBe('THETA');
        expect(normalized.tokenSymbol).toBe('THETA');
        expect(normalized.type).toBe('token_transfer');
        expect(normalized.tokenType).toBe('native');
        // THETA amounts should be normalized (not in wei)
        expect(normalized.amount).toBe('420.3337');
      }
    });

    it('should map TFUEL transfer with correct currency and type', () => {
      const rawTx: ThetaTransaction = {
        block_height: '30599639',
        data: {
          inputs: [
            {
              address: '0x6d882a1ae65377c12e8c1ad5a8b5cfa329edeb07',
              coins: { tfuelwei: '8000000000000000000000', thetawei: '0' },
            },
          ],
          outputs: [
            {
              address: '0x3b2cf117129bb01c47d51557e6efdbe3ae3637c4',
              coins: { tfuelwei: '7614412500000000000000', thetawei: '0' },
            },
          ],
        } as ThetaSendTransactionData,
        hash: '0x9312f29a4a4e6478b4f6e30d91d7407067d6350578a25669d1272f4624e8cc01',
        timestamp: new Date(1752686906 * 1000),
        type: 2,
      };

      const result = mapThetaExplorerTransaction(rawTx);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const normalized = result.value;
        expect(normalized.currency).toBe('TFUEL');
        expect(normalized.tokenSymbol).toBe('TFUEL');
        expect(normalized.type).toBe('transfer');
        expect(normalized.tokenType).toBe('native');
        // TFUEL amounts should be in wei
        expect(normalized.amount).toBe('7614412500000000000000');
      }
    });

    it('should prioritize THETA over TFUEL when both are non-zero', () => {
      const rawTx: ThetaTransaction = {
        block_height: '25171619',
        data: {
          inputs: [
            {
              address: '0x5a722d3c43e5e5cec5dd91391594309829ae0a24',
              coins: { tfuelwei: '150000000000000000000', thetawei: '60000000000000000000' },
            },
          ],
          outputs: [
            {
              address: '0x6d882a1ae65377c12e8c1ad5a8b5cfa329edeb07',
              coins: { tfuelwei: '100000000000000000000', thetawei: '50000000000000000000' },
            },
          ],
        } as ThetaSendTransactionData,
        hash: '0x171980dbb42e7c3ac5ae1df6dd2240523d751d82ac1bf6f338a4edb83e856eb1',
        timestamp: new Date(1715285402 * 1000),
        type: 2,
      };

      const result = mapThetaExplorerTransaction(rawTx);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const normalized = result.value;
        // Should prioritize THETA
        expect(normalized.currency).toBe('THETA');
        expect(normalized.tokenSymbol).toBe('THETA');
        expect(normalized.type).toBe('token_transfer');
        expect(normalized.amount).toBe('50');
      }
    });

    it('should handle source/target pattern (alternative API format)', () => {
      const rawTx: ThetaTransaction = {
        block_height: '30599571',
        data: {
          source: {
            address: '0x6d882a1ae65377c12e8c1ad5a8b5cfa329edeb07',
            coins: { tfuelwei: '0', thetawei: '500000000000000000000' },
          },
          target: {
            address: '0x3b2cf117129bb01c47d51557e6efdbe3ae3637c4',
            coins: { tfuelwei: '0', thetawei: '420333700000000000000' },
          },
        } as ThetaSendTransactionData,
        hash: '0xa8e2051371ac9307a54e5290ec522d679bd7ecde13b86fd85a5d6acbe3257a3a',
        timestamp: new Date(1752686427 * 1000),
        type: 2,
      };

      const result = mapThetaExplorerTransaction(rawTx);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const normalized = result.value;
        expect(normalized.currency).toBe('THETA');
        expect(normalized.tokenSymbol).toBe('THETA');
        expect(normalized.type).toBe('token_transfer');
        expect(normalized.amount).toBe('420.3337');
      }
    });
  });

  describe('Amount formatting', () => {
    it('should convert THETA amounts from wei to normalized', () => {
      const rawTx: ThetaTransaction = {
        block_height: '30599571',
        data: {
          outputs: [
            {
              address: '0x3b2cf117129bb01c47d51557e6efdbe3ae3637c4',
              coins: { tfuelwei: '0', thetawei: '123456789000000000000' },
            },
          ],
        } as ThetaSendTransactionData,
        hash: '0xabc',
        timestamp: new Date(1752686427 * 1000),
        type: 2,
      };

      const result = mapThetaExplorerTransaction(rawTx);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const normalized = result.value;
        expect(normalized.amount).toBe('123.456789');
      }
    });

    it('should keep TFUEL amounts in wei', () => {
      const rawTx: ThetaTransaction = {
        block_height: '30599571',
        data: {
          outputs: [
            {
              address: '0x3b2cf117129bb01c47d51557e6efdbe3ae3637c4',
              coins: { tfuelwei: '1000000000000000000', thetawei: '0' },
            },
          ],
        } as ThetaSendTransactionData,
        hash: '0xabc',
        timestamp: new Date(1752686427 * 1000),
        type: 2,
      };

      const result = mapThetaExplorerTransaction(rawTx);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const normalized = result.value;
        expect(normalized.amount).toBe('1000000000000000000');
      }
    });
  });

  describe('Transaction metadata', () => {
    it('should map all required fields correctly', () => {
      const rawTx: ThetaTransaction = {
        block_height: '30599571',
        data: {
          inputs: [
            {
              address: '0x6d882a1ae65377c12e8c1ad5a8b5cfa329edeb07',
              coins: { tfuelwei: '0', thetawei: '500000000000000000000' },
            },
          ],
          outputs: [
            {
              address: '0x3b2cf117129bb01c47d51557e6efdbe3ae3637c4',
              coins: { tfuelwei: '0', thetawei: '420333700000000000000' },
            },
          ],
        } as ThetaSendTransactionData,
        hash: '0xa8e2051371ac9307a54e5290ec522d679bd7ecde13b86fd85a5d6acbe3257a3a',
        timestamp: new Date(1752686427 * 1000),
        type: 2,
      };

      const result = mapThetaExplorerTransaction(rawTx);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const normalized = result.value;
        expect(normalized.id).toBe(rawTx.hash);
        expect(normalized.from).toBe('0x6d882a1ae65377c12e8c1ad5a8b5cfa329edeb07');
        expect(normalized.to).toBe('0x3b2cf117129bb01c47d51557e6efdbe3ae3637c4');
        expect(normalized.blockHeight).toBe(30599571);
        expect(normalized.timestamp).toBe(1752686427000); // milliseconds
        expect(normalized.providerName).toBe('theta-explorer');
        expect(normalized.status).toBe('success');
      }
    });
  });

  describe('Unsupported transaction types', () => {
    it('should return error for unsupported transaction type', () => {
      const rawTx: ThetaTransaction = {
        block_height: '30599571',
        data: {},
        hash: '0xabc',
        timestamp: new Date(1752686427 * 1000),
        type: 5, // Reserve fund transaction - not supported
      };

      const result = mapThetaExplorerTransaction(rawTx);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        const error = result.error;
        if (error.type === 'error') {
          expect(error.message).toContain('Unsupported transaction type: 5');
        } else {
          expect(error.reason).toContain('Unsupported transaction type: 5');
        }
      }
    });
  });
});
