import type { ImportSessionMetadata } from '@exitbook/core';
import { describe, expect, it } from 'vitest';

import type { BitcoinChainConfig } from '../../../chain-config.interface.js';
import { satoshisToBtcString } from '../../../utils.js';
import type { BlockstreamTransaction } from '../blockstream.schemas.js';
import { mapBlockstreamTransaction } from '../mapper-utils.js';

const mockSourceContext: ImportSessionMetadata = {
  name: 'test-provider',
  source: 'blockchain',
};

const mockBitcoinChainConfig: BitcoinChainConfig = {
  chainName: 'bitcoin',
  displayName: 'Bitcoin',
  nativeCurrency: 'BTC',
  nativeDecimals: 8,
};

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
