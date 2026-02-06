import { describe, expect, it } from 'vitest';

import { SUBSTRATE_CHAINS } from '../../../chain-registry.js';
import { convertSubscanTransaction } from '../subscan.mapper-utils.js';
import type { SubscanTransfer } from '../subscan.schemas.js';

describe('subscan.mapper-utils', () => {
  describe('convertSubscanTransaction', () => {
    const chainConfig = SUBSTRATE_CHAINS['polkadot']!;
    const nativeCurrency = 'DOT';
    const nativeDecimals = 10;

    it('should convert a valid transaction', () => {
      const transfer: SubscanTransfer = {
        hash: '0xabc123',
        from: 'addr1',
        to: 'addr2',
        amount: '1.5',
        fee: '100000000',
        block_num: 12345,
        block_timestamp: new Date('2024-01-01T00:00:00Z'),
        event_idx: 0,
        success: true,
        module: 'balances',
        extrinsic_index: '12345-2',
      };

      const relevantAddresses = new Set(['addr1']);

      const result = convertSubscanTransaction(
        transfer,
        relevantAddresses,
        chainConfig,
        nativeCurrency,
        nativeDecimals
      );

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.id).toBe('0xabc123');
        expect(result.value.from).toBe('addr1');
        expect(result.value.to).toBe('addr2');
        expect(result.value.amount).toBe('15000000000'); // 1.5 * 10^10
        expect(result.value.feeAmount).toBe('100000000');
        expect(result.value.status).toBe('success');
        expect(result.value.currency).toBe('DOT');
        expect(result.value.chainName).toBe('polkadot');
      }
    });

    it('should return skip error for irrelevant addresses', () => {
      const transfer: SubscanTransfer = {
        hash: '0xabc123',
        from: 'addr1',
        to: 'addr2',
        amount: '1.5',
        fee: '100000000',
        block_num: 12345,
        block_timestamp: new Date('2024-01-01T00:00:00Z'),
        event_idx: 0,
        success: true,
        module: 'balances',
        extrinsic_index: '12345-2',
      };

      const relevantAddresses = new Set(['addr3']); // Not in from or to

      const result = convertSubscanTransaction(
        transfer,
        relevantAddresses,
        chainConfig,
        nativeCurrency,
        nativeDecimals
      );

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.type).toBe('skip');
      }
    });

    it('should handle failed transactions', () => {
      const transfer: SubscanTransfer = {
        hash: '0xabc123',
        from: 'addr1',
        to: 'addr2',
        amount: '1.5',
        fee: '100000000',
        block_num: 12345,
        block_timestamp: new Date('2024-01-01T00:00:00Z'),
        event_idx: 0,
        success: false,
        module: 'balances',
        extrinsic_index: '12345-2',
      };

      const relevantAddresses = new Set(['addr1']);

      const result = convertSubscanTransaction(
        transfer,
        relevantAddresses,
        chainConfig,
        nativeCurrency,
        nativeDecimals
      );

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.status).toBe('failed');
      }
    });
  });
});
