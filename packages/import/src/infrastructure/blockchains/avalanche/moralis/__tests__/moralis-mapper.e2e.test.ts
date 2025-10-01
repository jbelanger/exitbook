import type { RawTransactionMetadata } from '@exitbook/import/app/ports/importers.js';
import type { ImportSessionMetadata } from '@exitbook/import/app/ports/transaction-processor.interface.js';
import { beforeAll, describe, expect, it } from 'vitest';

import type { MoralisTransaction } from '../../../shared/api/moralis-evm/moralis.types.ts';
import { ProviderRegistry } from '../../../shared/registry/provider-registry.ts';
import { MoralisApiClient } from '../moralis.api-client.js';
import { MoralisTransactionMapper } from '../moralis.mapper.js';

describe('MoralisTransactionMapper E2E', () => {
  const mapper = new MoralisTransactionMapper();
  const config = ProviderRegistry.createDefaultConfig('avalanche', 'moralis');
  const apiClient = new MoralisApiClient(config);
  const testAddress = '0x70c68a08d8c1C1Fa1CD5E5533e85a77c4Ac07022';

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
      expect(normalized.currency).toBe('AVAX');
      expect(normalized.providerId).toBe('moralis');
      expect(normalized.status).toMatch(/success|failed/);
      expect(normalized.from).toBe(rawTx.from_address);
      expect(normalized.to).toBe(rawTx.to_address);
      expect(normalized.timestamp).toBeGreaterThan(0);
      expect(normalized.blockHeight).toBeGreaterThan(0);
    }
  });

  it('should handle successful transactions correctly', () => {
    const successfulTx = cachedTransactions.find((tx) => tx.receipt_status === '1');
    if (!successfulTx) {
      console.warn('No successful transactions found, skipping test');
      return;
    }

    const metadata: RawTransactionMetadata = {
      providerId: 'moralis',
    };
    const sessionContext: ImportSessionMetadata = {
      address: testAddress,
    };

    const result = mapper.map(successfulTx, metadata, sessionContext);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const normalized = result.value;
      expect(normalized.status).toBe('success');
      expect(normalized.blockHeight).toBeDefined();
      expect(normalized.blockId).toBeDefined();
    }
  });

  it('should map transaction fees correctly', () => {
    const txWithGas = cachedTransactions.find((tx) => tx.receipt_gas_used && tx.gas_price);
    if (!txWithGas) {
      console.warn('No transactions with gas data found, skipping test');
      return;
    }

    const metadata: RawTransactionMetadata = {
      providerId: 'moralis',
    };
    const sessionContext: ImportSessionMetadata = {
      address: testAddress,
    };

    const result = mapper.map(txWithGas, metadata, sessionContext);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const normalized = result.value;
      expect(normalized.feeAmount).toBeDefined();
      expect(normalized.feeCurrency).toBe('AVAX');
      expect(parseFloat(normalized.feeAmount!)).toBeGreaterThan(0);
      expect(normalized.gasUsed).toBeDefined();
      expect(normalized.gasPrice).toBeDefined();
    }
  });

  it('should map amount correctly', () => {
    const txWithValue = cachedTransactions.find((tx) => tx.value !== '0');
    if (!txWithValue) {
      console.warn('No transactions with value found, skipping test');
      return;
    }

    const metadata: RawTransactionMetadata = {
      providerId: 'moralis',
    };
    const sessionContext: ImportSessionMetadata = {
      address: testAddress,
    };

    const result = mapper.map(txWithValue, metadata, sessionContext);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const normalized = result.value;
      expect(normalized.amount).toBeDefined();
      expect(parseFloat(normalized.amount)).toBeGreaterThan(0);
      // Value should be converted from wei to AVAX
      const valueInWei = BigInt(txWithValue.value);
      expect(valueInWei).toBeGreaterThan(0n);
    }
  });

  it('should map timestamps correctly', () => {
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
      expect(normalized.timestamp).toBeGreaterThan(0);
      // Timestamp should be a valid date
      const date = new Date(normalized.timestamp);
      expect(date.getTime()).toBeGreaterThan(0);
      // Should match the original block timestamp
      const originalDate = new Date(rawTx.block_timestamp);
      expect(normalized.timestamp).toBe(originalDate.getTime());
    }
  });

  it('should map block data correctly', () => {
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
      expect(normalized.blockHeight).toBe(parseInt(rawTx.block_number));
      expect(normalized.blockId).toBe(rawTx.block_hash);
      expect(normalized.blockHeight).toBeGreaterThan(0);
    }
  });

  it('should map method ID from input data', () => {
    const txWithInput = cachedTransactions.find((tx) => tx.input && tx.input.length >= 10);
    if (!txWithInput) {
      console.warn('No transactions with input data found, skipping test');
      return;
    }

    const metadata: RawTransactionMetadata = {
      providerId: 'moralis',
    };
    const sessionContext: ImportSessionMetadata = {
      address: testAddress,
    };

    const result = mapper.map(txWithInput, metadata, sessionContext);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const normalized = result.value;
      expect(normalized.methodId).toBeDefined();
      expect(normalized.methodId).toBe(txWithInput.input.slice(0, 10));
      expect(normalized.inputData).toBe(txWithInput.input);
    }
  });
});
