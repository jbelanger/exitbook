import type { Currency } from '@exitbook/core';
import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';

import type { BitcoinChainConfig } from '../../../chain-config.interface.js';
import { mapTatumTransaction } from '../mapper-utils.js';
import type { TatumBitcoinTransaction } from '../tatum.schemas.js';

const mockBitcoinChainConfig: BitcoinChainConfig = {
  chainName: 'bitcoin',
  displayName: 'Bitcoin',
  nativeCurrency: 'BTC' as Currency,
  nativeDecimals: 8,
};

describe('mapTatumTransaction', () => {
  it('should map confirmed Tatum transaction', () => {
    const rawData: TatumBitcoinTransaction = {
      hash: '5cb4eef31430d6b33b79c4b28f469d23dd62ac8524d0a4741c0b8920f31af5c0',
      blockNumber: 910910,
      block: '00000000000000000001b0990dc7c442d33d6845547570808d0b855ca0526421',
      time: 1755706690,
      fee: '390',
      version: 2,
      locktime: 0,
      size: 206,
      vsize: 155,
      weight: 617,
      witnessHash: '1c4aedc7b78c01f7ecd3a7d0e98580360a9add6754cf623265d9304254992db7',
      hex: '02000000000102b80f2d35fc56c813dd58ca27edfc753eff8e552eee37b405f02b79d7a8578fab0000000000ffffffff684aeeb7c2712211d28be2f5b9bfedaea20a0fa97c1f613a9e9179a82bf8c7ed00000000025100ffffffff01d67c0000000000002251200781f6b057db5688d505ad44ace7891a578e017c853fea2cff3c17e6fe151ac201408346f64d1e885a57a632c1a399f7627061aac3f0190b45800161522417a0f49c7ffa31b513c4edbfc26a4dc04d62c613a8e7423e1caacba332c8ecdbceeed3be0000000000',
      index: 522,
      inputs: [
        {
          coin: {
            address: 'bc1pws6pvj75rcsc2eglpp9k570prnjh40nfpyahlyumk8y8smjayvasyhns5c',
            coinbase: false,
            height: 910898,
            reqSigs: undefined,
            script: '51207434164bd41e2185651f084b6a79e11ce57abe69093b7f939bb1c8786e5d233b',
            type: undefined,
            value: 3586,
            version: 2,
          },
          prevout: {
            hash: 'ab8f57a8d7792bf005b437ee2e558eff3e75fced27ca58dd13c856fc352d0fb8',
            index: 0,
          },
          script: '',
          sequence: 4294967295,
        },
      ],
      outputs: [
        {
          address: 'bc1pq7qldvzhmdtg34g944z2eeufrftcuqtuls5l75t8l8st7dls4rtpquaguma',
          script: '51200781f6b057db5688d505ad44ace7891a578e017c853fea2cff3c17e6fe151ac2',
          scriptPubKey: {
            reqSigs: undefined,
            type: 'witness_v1_taproot',
          },
          value: 31958,
        },
      ],
    };

    const result = mapTatumTransaction(rawData, mockBitcoinChainConfig);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const normalized = result.value;
      expect(normalized).toMatchObject({
        id: '5cb4eef31430d6b33b79c4b28f469d23dd62ac8524d0a4741c0b8920f31af5c0',
        currency: 'BTC',
        providerName: 'tatum',
        status: 'success',
        timestamp: 1755706690000,
        blockHeight: 910910,
        blockId: '00000000000000000001b0990dc7c442d33d6845547570808d0b855ca0526421',
        feeCurrency: 'BTC',
      });

      expect(normalized.inputs).toHaveLength(1);
      expect(normalized.inputs[0]).toMatchObject({
        address: 'bc1pws6pvj75rcsc2eglpp9k570prnjh40nfpyahlyumk8y8smjayvasyhns5c',
        txid: 'ab8f57a8d7792bf005b437ee2e558eff3e75fced27ca58dd13c856fc352d0fb8',
        vout: 0,
        value: '3586',
      });

      expect(normalized.outputs).toHaveLength(1);
      expect(normalized.outputs[0]).toMatchObject({
        address: 'bc1pq7qldvzhmdtg34g944z2eeufrftcuqtuls5l75t8l8st7dls4rtpquaguma',
        index: 0,
        value: '31958',
      });
    }
  });

  it('should map unconfirmed Tatum transaction', () => {
    const rawData: TatumBitcoinTransaction = {
      hash: 'unconfirmed-hash',
      blockNumber: 0,
      block: '',
      time: 1700000000,
      fee: '200',
      version: 2,
      locktime: 0,
      size: 200,
      vsize: 150,
      weight: 600,
      witnessHash: 'witness-hash',
      hex: 'hex-data',
      index: 0,
      inputs: [
        {
          coin: {
            address: 'input-address',
            coinbase: false,
            height: 100000,
            script: 'script',
            value: 1000,
            version: 2,
            reqSigs: undefined,
            type: undefined,
          },
          prevout: {
            hash: 'prev-hash',
            index: 0,
          },
          script: '',
          sequence: 4294967295,
        },
      ],
      outputs: [
        {
          address: 'output-address',
          script: 'script',
          scriptPubKey: {
            reqSigs: undefined,
            type: 'p2pkh',
          },
          value: 800,
        },
      ],
    };

    const result = mapTatumTransaction(rawData, mockBitcoinChainConfig);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const normalized = result.value;
      expect(normalized.status).toBe('pending');
      expect(normalized.blockHeight).toBeUndefined();
      expect(normalized.blockId).toBeUndefined();
    }
  });

  it('should handle zero fee', () => {
    const rawData: TatumBitcoinTransaction = {
      hash: 'no-fee-hash',
      blockNumber: 12345,
      block: 'block-hash',
      time: 1700000000,
      fee: '0',
      version: 2,
      locktime: 0,
      size: 200,
      vsize: 150,
      weight: 600,
      witnessHash: 'witness-hash',
      hex: 'hex-data',
      index: 0,
      inputs: [
        {
          coin: {
            address: 'input-address',
            coinbase: false,
            height: 100000,
            script: 'script',
            value: 1000,
            version: 2,
            reqSigs: undefined,
            type: undefined,
          },
          prevout: {
            hash: 'prev-hash',
            index: 0,
          },
          script: '',
          sequence: 4294967295,
        },
      ],
      outputs: [
        {
          address: 'output-address',
          script: 'script',
          scriptPubKey: {
            reqSigs: undefined,
            type: 'p2pkh',
          },
          value: 1000,
        },
      ],
    };

    const result = mapTatumTransaction(rawData, mockBitcoinChainConfig);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const normalized = result.value;
      expect(normalized.feeAmount).toBeUndefined();
      expect(normalized.feeCurrency).toBeUndefined();
    }
  });

  it('should handle large fee correctly using Decimal', () => {
    const rawData: TatumBitcoinTransaction = {
      hash: 'large-fee-hash',
      blockNumber: 12345,
      block: 'block-hash',
      time: 1700000000,
      fee: '100000000',
      version: 2,
      locktime: 0,
      size: 200,
      vsize: 150,
      weight: 600,
      witnessHash: 'witness-hash',
      hex: 'hex-data',
      index: 0,
      inputs: [
        {
          coin: {
            address: 'input-address',
            coinbase: false,
            height: 100000,
            script: 'script',
            value: 200000000,
            version: 2,
            reqSigs: undefined,
            type: undefined,
          },
          prevout: {
            hash: 'prev-hash',
            index: 0,
          },
          script: '',
          sequence: 4294967295,
        },
      ],
      outputs: [
        {
          address: 'output-address',
          script: 'script',
          scriptPubKey: {
            reqSigs: undefined,
            type: 'p2pkh',
          },
          value: 100000000,
        },
      ],
    };

    const result = mapTatumTransaction(rawData, mockBitcoinChainConfig);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const normalized = result.value;
      const expectedFee = new Decimal(100000000).div(100000000).toFixed();
      expect(normalized.feeAmount).toBe(expectedFee);
      expect(normalized.feeAmount).toBe('1');
    }
  });
});
