import type { RawTransactionMetadata } from '@exitbook/import/app/ports/importers.js';
import type { ImportSessionMetadata } from '@exitbook/import/app/ports/transaction-processor.interface.js';
import { beforeAll, describe, expect, it } from 'vitest';

import type { MoralisTransaction } from '../../../shared/api/moralis-evm/moralis.types.js';
import { ProviderRegistry } from '../../../shared/index.ts';
import { MoralisApiClient } from '../moralis.api-client.js';
import { MoralisTransactionMapper } from '../moralis.mapper.js';

describe('MoralisTransactionMapper E2E', () => {
  const mapper = new MoralisTransactionMapper();
  const config = ProviderRegistry.createDefaultConfig('ethereum', 'moralis');
  const apiClient = new MoralisApiClient(config);
  const testAddress = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'; // Vitalik's address

  let cachedTransactions: MoralisTransaction[];

  beforeAll(async () => {
    // Fetch data once to avoid hammering the API
    cachedTransactions = await apiClient.execute<MoralisTransaction[]>({
      address: testAddress,
      type: 'getRawAddressTransactions',
    });
  }, 60000);

  it('should map real transaction data from API', () => {
    expect(cachedTransactions.length).toBeGreaterThan(0);

    const rawTx = cachedTransactions[0]!;
    const metadata: RawTransactionMetadata = {
      providerId: 'moralis',
    };
    const sessionContext: ImportSessionMetadata = {
      address: testAddress,
    };

    const result = mapper.map(rawTx, metadata, sessionContext);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const normalized = result.value;
      expect(normalized.id).toBe(rawTx.hash);
      expect(normalized.currency).toBe('ETH');
      expect(normalized.providerId).toBe('moralis');
      expect(normalized.status).toBeDefined();
      expect(normalized.from).toBe(rawTx.from_address);
      expect(normalized.to).toBe(rawTx.to_address);
      expect(normalized.timestamp).toBeGreaterThan(0);
      expect(normalized.blockHeight).toBeGreaterThan(0);
    }
  });

  it('should map native ETH transactions correctly', () => {
    // Find a transaction with actual value transfer
    const nativeTransfer = cachedTransactions.find((tx) => tx.value !== '0');
    if (!nativeTransfer) {
      console.warn('No native ETH transactions found, skipping test');
      return;
    }

    const metadata: RawTransactionMetadata = {
      providerId: 'moralis',
    };
    const sessionContext: ImportSessionMetadata = {
      address: testAddress,
    };

    const result = mapper.map(nativeTransfer, metadata, sessionContext);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const normalized = result.value;
      expect(normalized.currency).toBe('ETH');
      expect(normalized.type).toBe('transfer');
      expect(normalized.tokenType).toBe('native');
      expect(normalized.amount).toBeDefined();
      expect(parseFloat(normalized.amount)).toBeGreaterThanOrEqual(0);
    }
  });

  it('should map transaction timestamps correctly', () => {
    const txWithTimestamp = cachedTransactions.find((tx) => tx.block_timestamp);
    if (!txWithTimestamp) {
      console.warn('No transactions with timestamps found, skipping test');
      return;
    }

    const metadata: RawTransactionMetadata = {
      providerId: 'moralis',
    };
    const sessionContext: ImportSessionMetadata = {
      address: testAddress,
    };

    const result = mapper.map(txWithTimestamp, metadata, sessionContext);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const normalized = result.value;
      expect(normalized.timestamp).toBeGreaterThan(0);
      // Timestamp should be a valid date
      const date = new Date(normalized.timestamp);
      expect(date.getTime()).toBeGreaterThan(0);
    }
  });

  it('should map block height correctly', () => {
    const rawTx = cachedTransactions[0]!;
    const metadata: RawTransactionMetadata = {
      providerId: 'moralis',
    };
    const sessionContext: ImportSessionMetadata = {
      address: testAddress,
    };

    const result = mapper.map(rawTx, metadata, sessionContext);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const normalized = result.value;
      // block_number is a string representing a decimal number
      expect(normalized.blockHeight).toBe(parseInt(rawTx.block_number));
      expect(normalized.blockHeight).toBeGreaterThan(0);
    }
  });
});
