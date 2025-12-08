import { describe, expect, it } from 'vitest';

import type { BitcoinChainConfig } from '../../../chain-config.interface.js';
import { satoshisToBtcString } from '../../../utils.js';
import type { BlockchainComTransaction } from '../blockchain-com.schemas.js';
import { mapBlockchainComTransaction } from '../mapper-utils.js';

const mockBitcoinChainConfig: BitcoinChainConfig = {
  chainName: 'bitcoin',
  displayName: 'Bitcoin',
  nativeCurrency: 'BTC',
  nativeDecimals: 8,
};

describe('mapBlockchainComTransaction', () => {
  it('should map confirmed Blockchain.com transaction', () => {
    const rawData: BlockchainComTransaction = {
      block_index: undefined,
      hash: 'blockchain-com-hash',
      time: 1700000000,
      fee: 500,
      ver: 2,
      lock_time: 0,
      size: 250,
      block_height: 12345,
      double_spend: false,
      relayed_by: '0.0.0.0',
      result: 1000,
      tx_index: 123,
      vin_sz: 1,
      vout_sz: 1,
      inputs: [
        {
          script: 'script',
          prev_out: {
            addr: 'input-address',
            n: 0,
            script: 'script',
            spent: true,
            tx_index: 100,
            type: 0,
            value: 2000,
          },
        },
      ],
      out: [
        {
          addr: 'output-address',
          n: 0,
          script: 'script',
          spent: false,
          tx_index: 123,
          type: 0,
          value: 1500,
        },
      ],
    };

    const result = mapBlockchainComTransaction(rawData, mockBitcoinChainConfig);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const normalized = result.value;
      expect(normalized).toMatchObject({
        id: 'blockchain-com-hash',
        currency: 'BTC',
        providerName: 'blockchain.com',
        status: 'success',
        timestamp: 1700000000000,
        blockHeight: 12345,
        feeAmount: satoshisToBtcString(500),
        feeCurrency: 'BTC',
      });

      expect(normalized.inputs).toHaveLength(1);
      expect(normalized.inputs[0]).toMatchObject({
        address: 'input-address',
        value: '2000',
        vout: 0,
      });

      expect(normalized.outputs).toHaveLength(1);
      expect(normalized.outputs[0]).toMatchObject({
        address: 'output-address',
        index: 0,
        value: '1500',
      });
    }
  });

  it('should map unconfirmed Blockchain.com transaction', () => {
    const rawData: BlockchainComTransaction = {
      block_index: undefined,
      block_height: undefined,
      hash: 'unconfirmed-hash',
      time: 1700000000,
      fee: 200,
      ver: 2,
      lock_time: 0,
      size: 250,
      double_spend: false,
      relayed_by: '0.0.0.0',
      result: 1000,
      tx_index: 123,
      vin_sz: 1,
      vout_sz: 1,
      inputs: [
        {
          script: 'script',
          prev_out: {
            addr: 'input-address',
            n: 0,
            script: 'script',
            spent: true,
            tx_index: 100,
            type: 0,
            value: 1000,
          },
        },
      ],
      out: [
        {
          addr: 'output-address',
          n: 0,
          script: 'script',
          spent: false,
          tx_index: 123,
          type: 0,
          value: 800,
        },
      ],
    };

    const result = mapBlockchainComTransaction(rawData, mockBitcoinChainConfig);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const normalized = result.value;
      expect(normalized.status).toBe('pending');
      expect(normalized.blockHeight).toBeUndefined();
    }
  });

  it('should handle transactions without prev_out', () => {
    const rawData: BlockchainComTransaction = {
      block_index: undefined,
      hash: 'no-prevout-hash',
      time: 1700000000,
      fee: 200,
      ver: 2,
      lock_time: 0,
      size: 250,
      block_height: 12345,
      double_spend: false,
      relayed_by: '0.0.0.0',
      result: 1000,
      tx_index: 123,
      vin_sz: 1,
      vout_sz: 1,
      inputs: [
        {
          script: 'script',
        },
      ],
      out: [
        {
          addr: 'output-address',
          n: 0,
          script: 'script',
          spent: false,
          tx_index: 123,
          type: 0,
          value: 800,
        },
      ],
    };

    const result = mapBlockchainComTransaction(rawData, mockBitcoinChainConfig);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const normalized = result.value;
      expect(normalized.inputs[0]?.value).toBe('0');
      expect(normalized.inputs[0]?.address).toBeUndefined();
      expect(normalized.inputs[0]?.vout).toBeUndefined();
    }
  });

  it('should handle zero fee', () => {
    const rawData: BlockchainComTransaction = {
      block_index: undefined,
      hash: 'zero-fee-hash',
      time: 1700000000,
      fee: 0,
      ver: 2,
      lock_time: 0,
      size: 250,
      block_height: 12345,
      double_spend: false,
      relayed_by: '0.0.0.0',
      result: 1000,
      tx_index: 123,
      vin_sz: 1,
      vout_sz: 1,
      inputs: [
        {
          script: 'script',
          prev_out: {
            addr: 'input-address',
            n: 0,
            script: 'script',
            spent: true,
            tx_index: 100,
            type: 0,
            value: 1000,
          },
        },
      ],
      out: [
        {
          addr: 'output-address',
          n: 0,
          script: 'script',
          spent: false,
          tx_index: 123,
          type: 0,
          value: 1000,
        },
      ],
    };

    const result = mapBlockchainComTransaction(rawData, mockBitcoinChainConfig);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const normalized = result.value;
      expect(normalized.feeAmount).toBeUndefined();
      expect(normalized.feeCurrency).toBeUndefined();
    }
  });
});
