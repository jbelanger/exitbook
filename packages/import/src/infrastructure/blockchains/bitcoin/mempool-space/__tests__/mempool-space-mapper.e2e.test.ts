import type { RawTransactionMetadata } from '@exitbook/import/app/ports/importers.js';
import type { ImportSessionMetadata } from '@exitbook/import/app/ports/transaction-processor.interface.js';
import { beforeAll, describe, expect, it } from 'vitest';

import { ProviderRegistry } from '../../../shared/index.ts';
import { MempoolSpaceApiClient } from '../mempool-space-api-client.js';
import { MempoolSpaceTransactionMapper } from '../mempool-space.mapper.js';
import type { MempoolTransaction } from '../mempool-space.types.js';

describe('MempoolSpaceTransactionMapper E2E', () => {
  const mapper = new MempoolSpaceTransactionMapper();
  const config = ProviderRegistry.createDefaultConfig('bitcoin', 'mempool.space');
  const apiClient = new MempoolSpaceApiClient(config);
  const testAddress = '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa'; // Genesis block address

  let cachedTransactions: MempoolTransaction[];

  beforeAll(async () => {
    // Fetch data once to avoid hammering the API
    cachedTransactions = await apiClient.execute<MempoolTransaction[]>({
      address: testAddress,
      type: 'getRawAddressTransactions',
    });
  }, 60000);

  it('should map real transaction data from API', () => {
    expect(cachedTransactions.length).toBeGreaterThan(0);

    const rawTx = cachedTransactions[0]!;
    const metadata: RawTransactionMetadata = {
      providerId: 'mempool.space',
    };
    const sessionContext: ImportSessionMetadata = {
      address: testAddress,
    };

    const result = mapper.map(rawTx, metadata, sessionContext);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const normalized = result.value;
      expect(normalized.id).toBe(rawTx.txid);
      expect(normalized.currency).toBe('BTC');
      expect(normalized.providerId).toBe('mempool.space');
      expect(normalized.status).toMatch(/success|pending/);
      expect(Array.isArray(normalized.inputs)).toBe(true);
      expect(Array.isArray(normalized.outputs)).toBe(true);
      expect(normalized.timestamp).toBeGreaterThan(0);
    }
  });

  it('should handle confirmed transactions correctly', () => {
    const confirmedTx = cachedTransactions.find((tx) => tx.status.confirmed);
    if (!confirmedTx) {
      console.warn('No confirmed transactions found, skipping test');
      return;
    }

    const metadata: RawTransactionMetadata = {
      providerId: 'mempool.space',
    };
    const sessionContext: ImportSessionMetadata = {
      address: testAddress,
    };

    const result = mapper.map(confirmedTx, metadata, sessionContext);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const normalized = result.value;
      expect(normalized.status).toBe('success');
      expect(normalized.blockHeight).toBeDefined();
      expect(normalized.blockId).toBeDefined();
    }
  });

  it('should map transaction fees correctly', () => {
    const txWithFee = cachedTransactions.find((tx) => tx.fee > 0);
    if (!txWithFee) {
      console.warn('No transactions with fees found, skipping test');
      return;
    }

    const metadata: RawTransactionMetadata = {
      providerId: 'mempool.space',
    };
    const sessionContext: ImportSessionMetadata = {
      address: testAddress,
    };

    const result = mapper.map(txWithFee, metadata, sessionContext);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const normalized = result.value;
      expect(normalized.feeAmount).toBeDefined();
      expect(normalized.feeCurrency).toBe('BTC');
      expect(parseFloat(normalized.feeAmount!)).toBeGreaterThan(0);
    }
  });

  it('should map inputs and outputs with addresses', () => {
    const rawTx = cachedTransactions[0]!;
    const metadata: RawTransactionMetadata = {
      providerId: 'mempool.space',
    };
    const sessionContext: ImportSessionMetadata = {
      address: testAddress,
    };

    const result = mapper.map(rawTx, metadata, sessionContext);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const normalized = result.value;

      // Check inputs
      expect(normalized.inputs.length).toBe(rawTx.vin.length);
      normalized.inputs.forEach((input) => {
        expect(input).toHaveProperty('txid');
        expect(input).toHaveProperty('value');
        expect(input).toHaveProperty('vout');
      });

      // Check outputs
      expect(normalized.outputs.length).toBe(rawTx.vout.length);
      normalized.outputs.forEach((output, index) => {
        expect(output).toHaveProperty('value');
        expect(output.index).toBe(index);
      });
    }
  });
});
