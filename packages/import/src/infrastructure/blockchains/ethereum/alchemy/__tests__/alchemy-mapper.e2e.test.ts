import type { RawTransactionMetadata } from '@exitbook/import/app/ports/importers.js';
import type { ImportSessionMetadata } from '@exitbook/import/app/ports/transaction-processor.interface.js';
import { beforeAll, describe, expect, it } from 'vitest';

import { AlchemyApiClient } from '../alchemy.api-client.js';
import { AlchemyTransactionMapper } from '../alchemy.mapper.js';
import type { AlchemyAssetTransfer } from '../alchemy.types.js';

describe('AlchemyTransactionMapper E2E', () => {
  const mapper = new AlchemyTransactionMapper();
  const apiClient = new AlchemyApiClient();
  const testAddress = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'; // Vitalik's address

  let cachedTransactions: AlchemyAssetTransfer[];
  let cachedTokenTransactions: AlchemyAssetTransfer[];

  beforeAll(async () => {
    // Fetch data once to avoid hammering the API
    cachedTransactions = await apiClient.execute<AlchemyAssetTransfer[]>({
      address: testAddress,
      type: 'getRawAddressTransactions',
    });

    cachedTokenTransactions = await apiClient.execute<AlchemyAssetTransfer[]>({
      address: testAddress,
      type: 'getTokenTransactions',
    });
  }, 60000);

  it('should map real transaction data from API', () => {
    expect(cachedTransactions.length).toBeGreaterThan(0);

    const rawTx = cachedTransactions[0]!;
    const metadata: RawTransactionMetadata = {
      providerId: 'alchemy',
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
      expect(normalized.providerId).toBe('alchemy');
      expect(normalized.status).toBe('success');
      expect(normalized.from).toBe(rawTx.from);
      expect(normalized.to).toBe(rawTx.to);
      expect(normalized.timestamp).toBeGreaterThan(0);
      expect(normalized.blockHeight).toBeGreaterThan(0);
    }
  });

  it('should map native ETH transactions correctly', () => {
    const nativeTransfer = cachedTransactions.find((tx) => tx.category === 'external' || tx.category === 'internal');
    if (!nativeTransfer) {
      console.warn('No native ETH transactions found, skipping test');
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
      expect(normalized.currency).toBe('ETH');
      expect(normalized.type).toBe('transfer');
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
    const rawTx = cachedTransactions[0]!;
    const metadata: RawTransactionMetadata = {
      providerId: 'alchemy',
    };
    const sessionContext: ImportSessionMetadata = {
      address: testAddress,
    };

    const result = mapper.map(rawTx, metadata, sessionContext);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const normalized = result.value;
      // blockNum is a hex string, should be parsed to number
      expect(normalized.blockHeight).toBe(parseInt(rawTx.blockNum, 16));
      expect(normalized.blockHeight).toBeGreaterThan(0);
    }
  });
});
