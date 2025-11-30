import type { ImportSessionMetadata } from '@exitbook/core';
import { describe, expect, it } from 'vitest';

import type { BitcoinChainConfig } from '../../../chain-config.interface.js';
import { satoshisToBtcString } from '../../../utils.js';
import { mapMempoolSpaceTransaction } from '../mapper-utils.js';
import type { MempoolTransaction } from '../mempool-space.schemas.js';

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
