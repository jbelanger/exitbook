import type { RawTransactionMetadata, ImportSessionMetadata } from '@exitbook/data';

import { ProviderRegistry } from '../../../../../core/blockchain/index.ts';
import { AlchemyApiClient } from '../alchemy.api-client.js';
import { AlchemyTransactionMapper } from '../alchemy.mapper.js';
import type { AlchemyAssetTransfer } from '../alchemy.types.js';

describe('AlchemyTransactionMapper E2E', () => {
  const mapper = new AlchemyTransactionMapper();
  const config = ProviderRegistry.createDefaultConfig('ethereum', 'alchemy');
  const apiClient = new AlchemyApiClient(config);
  const testAddress = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'; // Vitalik's address

  let cachedTransactions: AlchemyAssetTransfer[];
  let cachedTokenTransactions: AlchemyAssetTransfer[];

  beforeAll(async () => {
    // Fetch data once to avoid hammering the API
    try {
      cachedTransactions = await apiClient.execute<AlchemyAssetTransfer[]>({
        address: testAddress,
        type: 'getRawAddressTransactions',
      });
      console.log(`✓ Fetched ${cachedTransactions.length} normal transactions`);
      if (cachedTransactions.length > 0) {
        console.log('Sample transaction:', JSON.stringify(cachedTransactions[0], undefined, 2).substring(0, 500));
      }

      cachedTokenTransactions = await apiClient.execute<AlchemyAssetTransfer[]>({
        address: testAddress,
        type: 'getTokenTransactions',
      });
      console.log(`✓ Fetched ${cachedTokenTransactions.length} token transactions`);
    } catch (error) {
      console.error('❌ Failed to fetch transactions:', error);
      throw error;
    }
  }, 60000);

  it('should map real transaction data from API', () => {
    // Use token transactions if no external transactions are available
    const transactions = cachedTransactions.length > 0 ? cachedTransactions : cachedTokenTransactions;

    if (transactions.length === 0) {
      console.error('❌ No transactions were cached - check beforeAll error or API key');
    }
    expect(transactions.length).toBeGreaterThan(0);

    const rawTx = transactions[0]!;
    const metadata: RawTransactionMetadata = {
      providerId: 'alchemy',
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
      expect(normalized.currency).toBeDefined(); // Currency depends on chain (ETH, AVAX, etc.)
      expect(normalized.providerId).toBe('alchemy');
      expect(normalized.status).toBe('success');
      expect(normalized.from).toBe(rawTx.from);
      expect(normalized.to).toBe(rawTx.to);
      expect(normalized.timestamp).toBeGreaterThan(0);
      expect(normalized.blockHeight).toBeGreaterThan(0);
    }
  });

  it('should map native EVM transactions correctly', () => {
    const nativeTransfer = cachedTransactions.find((tx) => tx.category === 'external');
    if (!nativeTransfer) {
      console.warn('No native external transactions found, skipping test');
      return;
    }

    const metadata: RawTransactionMetadata = {
      providerId: 'alchemy',
    };
    const sessionContext: ImportSessionMetadata = {
      address: testAddress,
    };

    const result = mapper.map(nativeTransfer, metadata, sessionContext);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const normalized = result.value;
      expect(normalized.currency).toBeDefined(); // ETH, AVAX, or MATIC
      expect(normalized.type).toBe('transfer');
      expect(normalized.tokenType).toBe('native');
      expect(normalized.amount).toBeDefined();
      expect(parseFloat(normalized.amount)).toBeGreaterThanOrEqual(0);
    }
  });

  it('should map internal transactions correctly', () => {
    // Internal transactions need to be fetched separately
    // For now we'll just test the mapping logic with a mock if we have the data
    const internalTransfer = cachedTransactions.find((tx) => tx.category === 'internal');
    if (!internalTransfer) {
      console.warn('No internal transactions found in test data, skipping test');
      return;
    }

    const metadata: RawTransactionMetadata = {
      providerId: 'alchemy',
    };
    const sessionContext: ImportSessionMetadata = {
      address: testAddress,
    };

    const result = mapper.map(internalTransfer, metadata, sessionContext);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const normalized = result.value;
      expect(normalized.currency).toBeDefined();
      expect(normalized.type).toBe('internal');
      expect(normalized.tokenType).toBe('native');
      expect(normalized.amount).toBeDefined();
      expect(parseFloat(normalized.amount)).toBeGreaterThanOrEqual(0);
    }
  });

  it('should map ERC20 token transactions correctly', () => {
    const erc20Transfer = cachedTokenTransactions.find((tx) => tx.category === 'erc20');
    if (!erc20Transfer) {
      console.warn('No ERC20 transactions found, skipping test');
      return;
    }

    const metadata: RawTransactionMetadata = {
      providerId: 'alchemy',
    };
    const sessionContext: ImportSessionMetadata = {
      address: testAddress,
    };

    const result = mapper.map(erc20Transfer, metadata, sessionContext);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const normalized = result.value;
      expect(normalized.type).toBe('token_transfer');
      expect(normalized.tokenType).toBe('erc20');
      expect(normalized.tokenAddress).toBeDefined();
      expect(normalized.tokenSymbol).toBeDefined();
      expect(normalized.currency).not.toBe('ETH');
      expect(normalized.amount).toBeDefined();
      expect(parseFloat(normalized.amount)).toBeGreaterThan(0);
    }
  });

  it('should map ERC721 NFT transactions correctly', () => {
    const erc721Transfer = cachedTokenTransactions.find((tx) => tx.category === 'erc721');
    if (!erc721Transfer) {
      console.warn('No ERC721 transactions found, skipping test');
      return;
    }

    const metadata: RawTransactionMetadata = {
      providerId: 'alchemy',
    };
    const sessionContext: ImportSessionMetadata = {
      address: testAddress,
    };

    const result = mapper.map(erc721Transfer, metadata, sessionContext);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const normalized = result.value;
      expect(normalized.type).toBe('token_transfer');
      expect(normalized.tokenType).toBe('erc721');
      expect(normalized.tokenAddress).toBeDefined();
      // For ERC721, amount should be 1
      expect(normalized.amount).toBe('1');
    }
  });

  it('should map transaction timestamps correctly', () => {
    const txWithTimestamp = cachedTransactions.find((tx) => tx.metadata?.blockTimestamp);
    if (!txWithTimestamp) {
      console.warn('No transactions with timestamps found, skipping test');
      return;
    }

    const metadata: RawTransactionMetadata = {
      providerId: 'alchemy',
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
    // Use token transactions if no external transactions are available
    const transactions = cachedTransactions.length > 0 ? cachedTransactions : cachedTokenTransactions;

    if (transactions.length === 0) {
      console.warn('No transactions available, skipping test');
      return;
    }

    const rawTx = transactions[0]!;
    const metadata: RawTransactionMetadata = {
      providerId: 'alchemy',
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
      // blockNum is a hex string, should be parsed to number
      expect(normalized.blockHeight).toBe(parseInt(rawTx.blockNum, 16));
      expect(normalized.blockHeight).toBeGreaterThan(0);
    }
  });
});
