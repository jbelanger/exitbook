import type { RawTransactionMetadata, ImportSessionMetadata } from '@exitbook/data';

import { ProviderRegistry } from '../../../../../core/blockchain/index.ts';
import { MoralisApiClient } from '../moralis.api-client.js';
import { MoralisTransactionMapper } from '../moralis.mapper.js';
import type { MoralisTransaction } from '../moralis.types.js';

describe('MoralisTransactionMapper E2E - Multi-Chain', () => {
  const mapper = new MoralisTransactionMapper();

  describe('Ethereum', () => {
    const config = ProviderRegistry.createDefaultConfig('ethereum', 'moralis');
    const apiClient = new MoralisApiClient(config);
    const testAddress = '0xE472E43C3417cd0E39F7289B2bC836C08F529CA7'; // Vitalik's address

    let cachedTransactions: MoralisTransaction[];

    beforeAll(async () => {
      // Fetch data once to avoid hammering the API
      try {
        cachedTransactions = await apiClient.execute<MoralisTransaction[]>({
          address: testAddress,
          type: 'getRawAddressTransactions',
        });
        console.log(`Fetched ${cachedTransactions.length} Ethereum transactions for testing`);
      } catch (error) {
        console.error('Failed to fetch Ethereum transactions:', error);
        throw error;
      }
    }, 60000);

    it('should map real Ethereum transaction data from API', () => {
      expect(cachedTransactions.length).toBeGreaterThan(0);

      const rawTx = cachedTransactions[0]!;
      const metadata: RawTransactionMetadata = {
        providerId: 'moralis',
      };
      const sessionContext: ImportSessionMetadata = {
        address: testAddress,
      };

      const result = mapper.map(rawTx, metadata, sessionContext);

      if (result.isErr()) {
        console.error('Mapper error:', result.error);
        console.error('Raw transaction data:', JSON.stringify(rawTx, undefined, 2));
      }
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const normalized = result.value;
        expect(normalized.id).toBe(rawTx.hash);
        expect(normalized.currency).toBe('ETH'); // Ethereum native currency
        expect(normalized.feeCurrency).toBe('ETH');
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
  });

  describe('Avalanche', () => {
    const config = ProviderRegistry.createDefaultConfig('avalanche', 'moralis');
    const apiClient = new MoralisApiClient(config);
    const testAddress = '0x9f8c163cBA728e99993ABe7495F06c0A3c8Ac8b9'; // Avalanche Foundation address

    let cachedTransactions: MoralisTransaction[];

    beforeAll(async () => {
      // Fetch data once to avoid hammering the API
      try {
        cachedTransactions = await apiClient.execute<MoralisTransaction[]>({
          address: testAddress,
          type: 'getRawAddressTransactions',
        });
        console.log(`Fetched ${cachedTransactions.length} Avalanche transactions for testing`);
      } catch (error) {
        console.error('Failed to fetch Avalanche transactions:', error);
        throw error;
      }
    }, 60000);

    it('should map real Avalanche transaction data from API', () => {
      expect(cachedTransactions.length).toBeGreaterThan(0);

      const rawTx = cachedTransactions[0]!;
      const metadata: RawTransactionMetadata = {
        providerId: 'moralis',
      };
      const sessionContext: ImportSessionMetadata = {
        address: testAddress,
      };

      const result = mapper.map(rawTx, metadata, sessionContext);

      if (result.isErr()) {
        console.error('Mapper error:', result.error);
        console.error('Raw transaction data:', JSON.stringify(rawTx, undefined, 2));
      }
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const normalized = result.value;
        expect(normalized.id).toBe(rawTx.hash);
        expect(normalized.currency).toBe('AVAX'); // Avalanche native currency
        expect(normalized.feeCurrency).toBe('AVAX');
        expect(normalized.providerId).toBe('moralis');
        expect(normalized.status).toBeDefined();
        expect(normalized.from).toBe(rawTx.from_address);
        expect(normalized.to).toBe(rawTx.to_address);
        expect(normalized.timestamp).toBeGreaterThan(0);
        expect(normalized.blockHeight).toBeGreaterThan(0);
      }
    });

    it('should map native AVAX transactions correctly', () => {
      // Find a transaction with actual value transfer
      const nativeTransfer = cachedTransactions.find((tx) => tx.value !== '0');
      if (!nativeTransfer) {
        console.warn('No native AVAX transactions found, skipping test');
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
        expect(normalized.currency).toBe('AVAX');
        expect(normalized.type).toBe('transfer');
        expect(normalized.tokenType).toBe('native');
        expect(normalized.amount).toBeDefined();
        expect(parseFloat(normalized.amount)).toBeGreaterThanOrEqual(0);
      }
    });
  });
});
