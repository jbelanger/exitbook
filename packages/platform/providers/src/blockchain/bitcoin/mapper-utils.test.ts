import type { SourceMetadata } from '@exitbook/core';
import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';

import type { BlockchainComTransaction } from './blockchain-com/blockchain-com.schemas.js';
import type { BlockCypherTransaction } from './blockcypher/blockcypher.schemas.js';
import type { BlockstreamTransaction } from './blockstream/blockstream.schemas.js';
import type { BitcoinChainConfig } from './chain-config.interface.js';
import {
  mapBlockchainComTransaction,
  mapBlockCypherTransaction,
  mapBlockstreamTransaction,
  mapMempoolSpaceTransaction,
  mapTatumTransaction,
  satoshisToBtcString,
} from './mapper-utils.js';
import type { MempoolTransaction } from './mempool-space/mempool-space.schemas.js';
import type { TatumBitcoinTransaction } from './tatum/tatum.schemas.js';

const mockSourceContext: SourceMetadata = {
  name: 'test-provider',
  source: 'blockchain',
};

const mockBitcoinChainConfig: BitcoinChainConfig = {
  chainName: 'bitcoin',
  displayName: 'Bitcoin',
  nativeCurrency: 'BTC',
  nativeDecimals: 8,
};

describe('mapper-utils', () => {
  describe('satoshisToBtcString', () => {
    it('should convert satoshis to BTC string without scientific notation', () => {
      expect(satoshisToBtcString(100000000)).toBe('1');
      expect(satoshisToBtcString(50000000)).toBe('0.5');
      expect(satoshisToBtcString(1000)).toBe('0.00001');
      expect(satoshisToBtcString(1)).toBe('0.00000001');
    });

    it('should handle zero satoshis', () => {
      expect(satoshisToBtcString(0)).toBe('0');
    });

    it('should handle large amounts without scientific notation', () => {
      expect(satoshisToBtcString(2100000000000000)).toBe('21000000');
    });

    it('should use Decimal.js to avoid floating point errors', () => {
      const result = satoshisToBtcString(123456789);
      const expected = new Decimal('123456789').div(100000000).toFixed();
      expect(result).toBe(expected);
      expect(result).toBe('1.23456789');
    });

    it('should handle very small amounts', () => {
      expect(satoshisToBtcString(1)).toBe('0.00000001');
      expect(satoshisToBtcString(10)).toBe('0.0000001');
    });

    it('should handle fractional satoshis', () => {
      expect(satoshisToBtcString(99999999)).toBe('0.99999999');
    });
  });

  describe('mapBlockstreamTransaction', () => {
    it('should map confirmed Blockstream transaction', () => {
      const rawData: BlockstreamTransaction = {
        txid: '5cb4eef31430d6b33b79c4b28f469d23dd62ac8524d0a4741c0b8920f31af5c0',
        version: 2,
        locktime: 0,
        size: 206,
        weight: 617,
        fee: 390,
        status: {
          confirmed: true,
          block_height: 910910,
          block_hash: '00000000000000000001b0990dc7c442d33d6845547570808d0b855ca0526421',
          block_time: new Date('2025-06-20T14:31:30.000Z'),
        },
        vin: [
          {
            txid: 'ab8f57a8d7792bf005b437ee2e558eff3e75fced27ca58dd13c856fc352d0fb8',
            vout: 0,
            sequence: 4294967295,
            is_coinbase: false,
            scriptsig: '',
            scriptsig_asm: '',
            prevout: {
              scriptpubkey: '51207434164bd41e2185651f084b6a79e11ce57abe69093b7f939bb1c8786e5d233b',
              scriptpubkey_address: 'bc1pws6pvj75rcsc2eglpp9k570prnjh40nfpyahlyumk8y8smjayvasyhns5c',
              scriptpubkey_asm: 'OP_1 7434164bd41e2185651f084b6a79e11ce57abe69093b7f939bb1c8786e5d233b',
              scriptpubkey_type: 'v1_p2tr',
              value: 3586,
            },
          },
        ],
        vout: [
          {
            scriptpubkey: '51200781f6b057db5688d505ad44ace7891a578e017c853fea2cff3c17e6fe151ac2',
            scriptpubkey_address: 'bc1pq7qldvzhmdtg34g944z2eeufrftcuqtuls5l75t8l8st7dls4rtpquaguma',
            scriptpubkey_asm: 'OP_1 0781f6b057db5688d505ad44ace7891a578e017c853fea2cff3c17e6fe151ac2',
            scriptpubkey_type: 'v1_p2tr',
            value: 31958,
          },
        ],
      };

      const result = mapBlockstreamTransaction(rawData, mockSourceContext, mockBitcoinChainConfig);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const normalized = result.value;
        expect(normalized).toMatchObject({
          id: '5cb4eef31430d6b33b79c4b28f469d23dd62ac8524d0a4741c0b8920f31af5c0',
          currency: 'BTC',
          providerName: 'blockstream.info',
          status: 'success',
          timestamp: new Date('2025-06-20T14:31:30.000Z').getTime(),
          blockHeight: 910910,
          blockId: '00000000000000000001b0990dc7c442d33d6845547570808d0b855ca0526421',
          feeAmount: satoshisToBtcString(390),
          feeCurrency: 'BTC',
        });

        expect(normalized.inputs).toHaveLength(1);
        expect(normalized.inputs[0]).toMatchObject({
          txid: 'ab8f57a8d7792bf005b437ee2e558eff3e75fced27ca58dd13c856fc352d0fb8',
          vout: 0,
          address: 'bc1pws6pvj75rcsc2eglpp9k570prnjh40nfpyahlyumk8y8smjayvasyhns5c',
          value: '3586',
        });

        expect(normalized.outputs).toHaveLength(1);
        expect(normalized.outputs[0]).toMatchObject({
          index: 0,
          address: 'bc1pq7qldvzhmdtg34g944z2eeufrftcuqtuls5l75t8l8st7dls4rtpquaguma',
          value: '31958',
        });
      }
    });

    it('should map unconfirmed Blockstream transaction', () => {
      const rawData: BlockstreamTransaction = {
        txid: 'abc123',
        version: 2,
        locktime: 0,
        size: 200,
        weight: 600,
        fee: 0,
        status: {
          confirmed: false,
        },
        vin: [
          {
            txid: 'input-txid',
            vout: 0,
            sequence: 4294967295,
            is_coinbase: false,
            scriptsig: '',
            scriptsig_asm: '',
            prevout: {
              scriptpubkey: 'script',
              scriptpubkey_asm: 'asm',
              scriptpubkey_type: 'type',
              value: 1000,
            },
          },
        ],
        vout: [
          {
            scriptpubkey: 'script',
            scriptpubkey_asm: 'asm',
            scriptpubkey_type: 'type',
            value: 1000,
          },
        ],
      };

      const result = mapBlockstreamTransaction(rawData, mockSourceContext, mockBitcoinChainConfig);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const normalized = result.value;
        expect(normalized.status).toBe('pending');
        expect(normalized.blockHeight).toBeUndefined();
        expect(normalized.blockId).toBeUndefined();
        expect(normalized.feeAmount).toBeUndefined();
        expect(normalized.feeCurrency).toBeUndefined();
      }
    });

    it('should handle transactions without addresses', () => {
      const rawData: BlockstreamTransaction = {
        txid: 'abc123',
        version: 2,
        locktime: 0,
        size: 200,
        weight: 600,
        fee: 100,
        status: {
          confirmed: true,
          block_height: 12345,
        },
        vin: [
          {
            txid: 'input-txid',
            vout: 0,
            sequence: 4294967295,
            is_coinbase: false,
            scriptsig: '',
            scriptsig_asm: '',
            prevout: {
              scriptpubkey: 'script',
              scriptpubkey_asm: 'asm',
              scriptpubkey_type: 'nulldata',
              value: 1000,
            },
          },
        ],
        vout: [
          {
            scriptpubkey: 'script',
            scriptpubkey_asm: 'asm',
            scriptpubkey_type: 'nulldata',
            value: 900,
          },
        ],
      };

      const result = mapBlockstreamTransaction(rawData, mockSourceContext, mockBitcoinChainConfig);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const normalized = result.value;
        expect(normalized.inputs[0]?.address).toBeUndefined();
        expect(normalized.outputs[0]?.address).toBeUndefined();
      }
    });

    it('should handle multiple inputs and outputs', () => {
      const rawData: BlockstreamTransaction = {
        txid: 'multi-io-tx',
        version: 2,
        locktime: 0,
        size: 400,
        weight: 1200,
        fee: 500,
        status: {
          confirmed: true,
          block_height: 12345,
          block_hash: 'block-hash',
          block_time: new Date('2025-01-01T00:00:00.000Z'),
        },
        vin: [
          {
            txid: 'input-1',
            vout: 0,
            sequence: 4294967295,
            is_coinbase: false,
            scriptsig: '',
            scriptsig_asm: '',
            prevout: {
              scriptpubkey: 'script',
              scriptpubkey_address: 'address-1',
              scriptpubkey_asm: 'asm',
              scriptpubkey_type: 'type',
              value: 5000,
            },
          },
          {
            txid: 'input-2',
            vout: 1,
            sequence: 4294967295,
            is_coinbase: false,
            scriptsig: '',
            scriptsig_asm: '',
            prevout: {
              scriptpubkey: 'script',
              scriptpubkey_address: 'address-2',
              scriptpubkey_asm: 'asm',
              scriptpubkey_type: 'type',
              value: 3000,
            },
          },
        ],
        vout: [
          {
            scriptpubkey: 'script',
            scriptpubkey_address: 'output-address-1',
            scriptpubkey_asm: 'asm',
            scriptpubkey_type: 'type',
            value: 4000,
          },
          {
            scriptpubkey: 'script',
            scriptpubkey_address: 'output-address-2',
            scriptpubkey_asm: 'asm',
            scriptpubkey_type: 'type',
            value: 3500,
          },
        ],
      };

      const result = mapBlockstreamTransaction(rawData, mockSourceContext, mockBitcoinChainConfig);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const normalized = result.value;
        expect(normalized.inputs).toHaveLength(2);
        expect(normalized.outputs).toHaveLength(2);
        expect(normalized.feeAmount).toBe(satoshisToBtcString(500));
      }
    });
  });

  describe('mapMempoolSpaceTransaction', () => {
    it('should map confirmed Mempool.space transaction', () => {
      const rawData: MempoolTransaction = {
        txid: '5cb4eef31430d6b33b79c4b28f469d23dd62ac8524d0a4741c0b8920f31af5c0',
        version: 2,
        locktime: 0,
        size: 206,
        weight: 617,
        fee: 390,
        status: {
          confirmed: true,
          block_height: 910910,
          block_hash: '00000000000000000001b0990dc7c442d33d6845547570808d0b855ca0526421',
          block_time: new Date('2025-06-20T14:31:30.000Z'),
        },
        vin: [
          {
            txid: 'ab8f57a8d7792bf005b437ee2e558eff3e75fced27ca58dd13c856fc352d0fb8',
            vout: 0,
            sequence: 4294967295,
            scriptsig: '',
            scriptsig_asm: '',
            prevout: {
              scriptpubkey: '51207434164bd41e2185651f084b6a79e11ce57abe69093b7f939bb1c8786e5d233b',
              scriptpubkey_address: 'bc1pws6pvj75rcsc2eglpp9k570prnjh40nfpyahlyumk8y8smjayvasyhns5c',
              scriptpubkey_asm: 'OP_1 7434164bd41e2185651f084b6a79e11ce57abe69093b7f939bb1c8786e5d233b',
              scriptpubkey_type: 'v1_p2tr',
              value: 3586,
            },
          },
        ],
        vout: [
          {
            scriptpubkey: '51200781f6b057db5688d505ad44ace7891a578e017c853fea2cff3c17e6fe151ac2',
            scriptpubkey_address: 'bc1pq7qldvzhmdtg34g944z2eeufrftcuqtuls5l75t8l8st7dls4rtpquaguma',
            scriptpubkey_asm: 'OP_1 0781f6b057db5688d505ad44ace7891a578e017c853fea2cff3c17e6fe151ac2',
            scriptpubkey_type: 'v1_p2tr',
            value: 31958,
          },
        ],
      };

      const result = mapMempoolSpaceTransaction(rawData, mockSourceContext, mockBitcoinChainConfig);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const normalized = result.value;
        expect(normalized).toMatchObject({
          id: '5cb4eef31430d6b33b79c4b28f469d23dd62ac8524d0a4741c0b8920f31af5c0',
          currency: 'BTC',
          providerName: 'mempool.space',
          status: 'success',
          timestamp: new Date('2025-06-20T14:31:30.000Z').getTime(),
          blockHeight: 910910,
          blockId: '00000000000000000001b0990dc7c442d33d6845547570808d0b855ca0526421',
          feeAmount: satoshisToBtcString(390),
          feeCurrency: 'BTC',
        });

        expect(normalized.inputs).toHaveLength(1);
        expect(normalized.outputs).toHaveLength(1);
      }
    });

    it('should map unconfirmed Mempool.space transaction', () => {
      const rawData: MempoolTransaction = {
        txid: 'unconfirmed-tx',
        version: 2,
        locktime: 0,
        size: 200,
        weight: 600,
        fee: 0,
        status: {
          confirmed: false,
        },
        vin: [
          {
            txid: 'input-txid',
            vout: 0,
            sequence: 4294967295,
            scriptsig: '',
            scriptsig_asm: '',
            prevout: {
              scriptpubkey: 'script',
              scriptpubkey_asm: 'asm',
              scriptpubkey_type: 'type',
              value: 1000,
            },
          },
        ],
        vout: [
          {
            scriptpubkey: 'script',
            scriptpubkey_asm: 'asm',
            scriptpubkey_type: 'type',
            value: 1000,
          },
        ],
      };

      const result = mapMempoolSpaceTransaction(rawData, mockSourceContext, mockBitcoinChainConfig);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const normalized = result.value;
        expect(normalized.status).toBe('pending');
        expect(normalized.providerName).toBe('mempool.space');
      }
    });

    it('should handle transactions without prevout', () => {
      const rawData: MempoolTransaction = {
        txid: 'tx-no-prevout',
        version: 2,
        locktime: 0,
        size: 200,
        weight: 600,
        fee: 100,
        status: {
          confirmed: true,
          block_height: 12345,
        },
        vin: [
          {
            txid: 'input-txid',
            vout: 0,
            sequence: 4294967295,
            scriptsig: '',
            scriptsig_asm: '',
          },
        ],
        vout: [
          {
            scriptpubkey: 'script',
            scriptpubkey_asm: 'asm',
            scriptpubkey_type: 'type',
            value: 900,
          },
        ],
      };

      const result = mapMempoolSpaceTransaction(rawData, mockSourceContext, mockBitcoinChainConfig);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const normalized = result.value;
        expect(normalized.inputs[0]?.value).toBe('0');
        expect(normalized.inputs[0]?.address).toBeUndefined();
      }
    });
  });

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

      const result = mapTatumTransaction(rawData, mockSourceContext, mockBitcoinChainConfig);

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

      const result = mapTatumTransaction(rawData, mockSourceContext, mockBitcoinChainConfig);

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

      const result = mapTatumTransaction(rawData, mockSourceContext, mockBitcoinChainConfig);

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

      const result = mapTatumTransaction(rawData, mockSourceContext, mockBitcoinChainConfig);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const normalized = result.value;
        const expectedFee = new Decimal(100000000).div(100000000).toFixed();
        expect(normalized.feeAmount).toBe(expectedFee);
        expect(normalized.feeAmount).toBe('1');
      }
    });
  });

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

      const result = mapBlockchainComTransaction(rawData, mockSourceContext, mockBitcoinChainConfig);

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

      const result = mapBlockchainComTransaction(rawData, mockSourceContext, mockBitcoinChainConfig);

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

      const result = mapBlockchainComTransaction(rawData, mockSourceContext, mockBitcoinChainConfig);

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

      const result = mapBlockchainComTransaction(rawData, mockSourceContext, mockBitcoinChainConfig);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const normalized = result.value;
        expect(normalized.feeAmount).toBeUndefined();
        expect(normalized.feeCurrency).toBeUndefined();
      }
    });
  });

  describe('mapBlockCypherTransaction', () => {
    it('should map confirmed BlockCypher transaction', () => {
      const rawData: BlockCypherTransaction = {
        hash: 'blockcypher-hash',
        block_hash: 'block-hash',
        block_height: 12345,
        block_index: 10,
        confirmations: 6,
        confirmed: '2025-01-01T00:00:00Z',
        received: '2025-01-01T00:00:00Z',
        fees: 400,
        preference: 'high',
        double_spend: false,
        confidence: 1,
        ver: 2,
        lock_time: 0,
        size: 250,
        vsize: 200,
        inputs: [
          {
            prev_hash: 'prev-hash',
            output_index: 0,
            output_value: 3000,
            addresses: ['input-address'],
            script_type: 'pay-to-pubkey-hash',
            age: 100,
            sequence: 4294967295,
          },
        ],
        outputs: [
          {
            value: 2600,
            addresses: ['output-address'],
            script: 'script',
            script_type: 'pay-to-pubkey-hash',
          },
        ],
      };

      const result = mapBlockCypherTransaction(rawData, mockSourceContext, mockBitcoinChainConfig);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const normalized = result.value;
        expect(normalized).toMatchObject({
          id: 'blockcypher-hash',
          currency: 'BTC',
          providerName: 'blockcypher',
          status: 'success',
          blockHeight: 12345,
          blockId: 'block-hash',
          feeAmount: satoshisToBtcString(400),
          feeCurrency: 'BTC',
        });

        expect(normalized.inputs).toHaveLength(1);
        expect(normalized.inputs[0]).toMatchObject({
          address: 'input-address',
          txid: 'prev-hash',
          vout: 0,
          value: '3000',
        });

        expect(normalized.outputs).toHaveLength(1);
        expect(normalized.outputs[0]).toMatchObject({
          address: 'output-address',
          index: 0,
          value: '2600',
        });
      }
    });

    it('should map unconfirmed BlockCypher transaction', () => {
      const rawData: BlockCypherTransaction = {
        hash: 'unconfirmed-hash',
        confirmations: 0,
        received: '2025-01-01T00:00:00Z',
        fees: 200,
        preference: 'medium',
        double_spend: false,
        confidence: 0.95,
        ver: 2,
        lock_time: 0,
        size: 250,
        vsize: 200,
        inputs: [
          {
            prev_hash: 'prev-hash',
            output_index: 0,
            output_value: 1000,
            addresses: ['input-address'],
            script_type: 'pay-to-pubkey-hash',
            age: 0,
            sequence: 4294967295,
          },
        ],
        outputs: [
          {
            value: 800,
            addresses: ['output-address'],
            script: 'script',
            script_type: 'pay-to-pubkey-hash',
          },
        ],
      };

      const result = mapBlockCypherTransaction(rawData, mockSourceContext, mockBitcoinChainConfig);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const normalized = result.value;
        expect(normalized.status).toBe('pending');
        expect(normalized.blockHeight).toBeUndefined();
        expect(normalized.blockId).toBeUndefined();
      }
    });

    it('should handle transactions with empty addresses arrays', () => {
      const rawData: BlockCypherTransaction = {
        hash: 'no-addresses-hash',
        block_height: 12345,
        block_hash: 'block-hash',
        confirmations: 6,
        confirmed: '2025-01-01T00:00:00Z',
        received: '2025-01-01T00:00:00Z',
        fees: 300,
        preference: 'high',
        double_spend: false,
        confidence: 1,
        ver: 2,
        lock_time: 0,
        size: 250,
        vsize: 200,
        inputs: [
          {
            prev_hash: 'prev-hash',
            output_index: 0,
            output_value: 1000,
            addresses: [],
            script_type: 'nulldata',
            age: 100,
            sequence: 4294967295,
          },
        ],
        outputs: [
          {
            value: 700,
            addresses: [],
            script: 'script',
            script_type: 'nulldata',
          },
        ],
      };

      const result = mapBlockCypherTransaction(rawData, mockSourceContext, mockBitcoinChainConfig);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const normalized = result.value;
        expect(normalized.inputs[0]?.address).toBeUndefined();
        expect(normalized.outputs[0]?.address).toBeUndefined();
      }
    });

    it('should handle zero fee', () => {
      const rawData: BlockCypherTransaction = {
        hash: 'zero-fee-hash',
        block_height: 12345,
        block_hash: 'block-hash',
        confirmations: 6,
        confirmed: '2025-01-01T00:00:00Z',
        received: '2025-01-01T00:00:00Z',
        fees: 0,
        preference: 'low',
        double_spend: false,
        confidence: 1,
        ver: 2,
        lock_time: 0,
        size: 250,
        vsize: 200,
        inputs: [
          {
            prev_hash: 'prev-hash',
            output_index: 0,
            output_value: 1000,
            addresses: ['input-address'],
            script_type: 'pay-to-pubkey-hash',
            age: 100,
            sequence: 4294967295,
          },
        ],
        outputs: [
          {
            value: 1000,
            addresses: ['output-address'],
            script: 'script',
            script_type: 'pay-to-pubkey-hash',
          },
        ],
      };

      const result = mapBlockCypherTransaction(rawData, mockSourceContext, mockBitcoinChainConfig);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const normalized = result.value;
        expect(normalized.feeAmount).toBeUndefined();
        expect(normalized.feeCurrency).toBeUndefined();
      }
    });

    it('should use Date.now() timestamp when not confirmed', () => {
      const beforeTime = Date.now();
      const rawData: BlockCypherTransaction = {
        hash: 'unconfirmed-timestamp',
        confirmations: 0,
        received: '2025-01-15T10:30:00Z',
        fees: 200,
        preference: 'medium',
        double_spend: false,
        confidence: 0.95,
        ver: 2,
        lock_time: 0,
        size: 250,
        vsize: 200,
        inputs: [
          {
            prev_hash: 'prev-hash',
            output_index: 0,
            output_value: 1000,
            addresses: ['input-address'],
            script_type: 'pay-to-pubkey-hash',
            age: 0,
            sequence: 4294967295,
          },
        ],
        outputs: [
          {
            value: 800,
            addresses: ['output-address'],
            script: 'script',
            script_type: 'pay-to-pubkey-hash',
          },
        ],
      };

      const result = mapBlockCypherTransaction(rawData, mockSourceContext, mockBitcoinChainConfig);
      const afterTime = Date.now();

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const normalized = result.value;
        expect(normalized.timestamp).toBeGreaterThanOrEqual(beforeTime);
        expect(normalized.timestamp).toBeLessThanOrEqual(afterTime);
      }
    });
  });
});
