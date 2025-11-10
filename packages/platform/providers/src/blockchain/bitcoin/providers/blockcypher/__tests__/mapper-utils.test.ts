import type { SourceMetadata } from '@exitbook/core';
import { describe, expect, it } from 'vitest';

import type { BitcoinChainConfig } from '../../../chain-config.interface.ts';
import { satoshisToBtcString } from '../../../utils.ts';
import type { BlockCypherTransaction } from '../blockcypher.schemas.ts';
import { mapBlockCypherTransaction } from '../mapper-utils.ts';

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
