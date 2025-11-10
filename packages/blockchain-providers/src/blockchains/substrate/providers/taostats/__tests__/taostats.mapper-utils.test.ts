import { describe, expect, it } from 'vitest';

import { convertTaostatsTransaction, isTransactionRelevant } from '../taostats.mapper-utils.js';
import type { TaostatsTransaction } from '../taostats.schemas.js';

describe('taostats.mapper-utils', () => {
  describe('convertTaostatsTransaction', () => {
    it('should convert a valid Taostats transaction', () => {
      const rawData: TaostatsTransaction = {
        transaction_hash: '0xabc123',
        from: { ss58: '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY', hex: '0x123' },
        to: { ss58: '5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty', hex: '0x456' },
        amount: '1000000000',
        fee: '100000',
        block_number: 12345,
        timestamp: new Date('2024-01-01T00:00:00Z'),
        extrinsic_id: '12345-2',
        network: 'finney',
        id: 'txid123',
      };

      const result = convertTaostatsTransaction(rawData, {}, 'TAO');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.id).toBe('0xabc123');
        expect(result.value.from).toBe('5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY');
        expect(result.value.to).toBe('5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty');
        expect(result.value.amount).toBe('1000000000');
        expect(result.value.feeAmount).toBe('100000');
        expect(result.value.status).toBe('success');
        expect(result.value.currency).toBe('TAO');
        expect(result.value.chainName).toBe('bittensor');
        expect(result.value.providerName).toBe('taostats');
      }
    });

    it('should handle missing fee', () => {
      const rawData: TaostatsTransaction = {
        transaction_hash: '0xabc123',
        from: { ss58: '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY', hex: '0x123' },
        to: { ss58: '5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty', hex: '0x456' },
        amount: '1000000000',
        block_number: 12345,
        timestamp: new Date('2024-01-01T00:00:00Z'),
        extrinsic_id: '12345-2',
        network: 'finney',
        id: 'txid123',
      };

      const result = convertTaostatsTransaction(rawData, {}, 'TAO');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.feeAmount).toBe('0');
      }
    });
  });

  describe('isTransactionRelevant', () => {
    it('should return true if from address is relevant', () => {
      const rawData: TaostatsTransaction = {
        transaction_hash: '0xabc123',
        from: { ss58: '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY', hex: '0x123' },
        to: { ss58: '5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty', hex: '0x456' },
        amount: '1000000000',
        block_number: 12345,
        timestamp: new Date('2024-01-01T00:00:00Z'),
        extrinsic_id: '12345-2',
        network: 'finney',
        id: 'txid123',
      };

      const relevantAddresses = new Set(['5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY']);

      expect(isTransactionRelevant(rawData, relevantAddresses)).toBe(true);
    });

    it('should return true if to address is relevant', () => {
      const rawData: TaostatsTransaction = {
        transaction_hash: '0xabc123',
        from: { ss58: '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY', hex: '0x123' },
        to: { ss58: '5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty', hex: '0x456' },
        amount: '1000000000',
        block_number: 12345,
        timestamp: new Date('2024-01-01T00:00:00Z'),
        extrinsic_id: '12345-2',
        network: 'finney',
        id: 'txid123',
      };

      const relevantAddresses = new Set(['5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty']);

      expect(isTransactionRelevant(rawData, relevantAddresses)).toBe(true);
    });

    it('should return false if neither address is relevant', () => {
      const rawData: TaostatsTransaction = {
        transaction_hash: '0xabc123',
        from: { ss58: '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY', hex: '0x123' },
        to: { ss58: '5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty', hex: '0x456' },
        amount: '1000000000',
        block_number: 12345,
        timestamp: new Date('2024-01-01T00:00:00Z'),
        extrinsic_id: '12345-2',
        network: 'finney',
        id: 'txid123',
      };

      const relevantAddresses = new Set(['5SomeOtherAddress']);

      expect(isTransactionRelevant(rawData, relevantAddresses)).toBe(false);
    });
  });
});
