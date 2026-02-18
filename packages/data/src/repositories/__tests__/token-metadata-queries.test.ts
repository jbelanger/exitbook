import type { TokenMetadataRecord } from '@exitbook/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  closeTokenMetadataDatabase,
  createTokenMetadataDatabase,
  initializeTokenMetadataDatabase,
  type TokenMetadataDB,
} from '../../persistence/token-metadata/database.js';
import { createTokenMetadataQueries, type TokenMetadataQueries } from '../token-metadata-queries.js';

describe('TokenMetadataQueries', () => {
  let db: TokenMetadataDB;
  let queries: TokenMetadataQueries;

  beforeEach(async () => {
    const dbResult = createTokenMetadataDatabase(':memory:');
    if (dbResult.isErr()) {
      throw dbResult.error;
    }
    db = dbResult.value;

    const initResult = await initializeTokenMetadataDatabase(db);
    if (initResult.isErr()) {
      throw initResult.error;
    }

    queries = createTokenMetadataQueries(db);
  });

  afterEach(async () => {
    const closeResult = await closeTokenMetadataDatabase(db);
    if (closeResult.isErr()) {
      throw closeResult.error;
    }
  });

  describe('save with spam detection fields', () => {
    it('should insert metadata with possibleSpam true', async () => {
      const metadata: TokenMetadataRecord = {
        blockchain: 'ethereum',
        contractAddress: '0x123',
        name: 'Scam Token',
        possibleSpam: true,
        refreshedAt: new Date(),
        source: 'moralis',
        symbol: 'SCAM',
      };

      const result = await queries.save('ethereum', '0x123', metadata);

      expect(result.isOk()).toBe(true);

      const retrieved = await queries.getByContract('ethereum', '0x123');
      expect(retrieved.isOk()).toBe(true);
      expect(retrieved._unsafeUnwrap()?.possibleSpam).toBe(true);
    });

    it('should insert metadata with possibleSpam false', async () => {
      const metadata: TokenMetadataRecord = {
        blockchain: 'ethereum',
        contractAddress: '0x123',
        name: 'Legitimate Token',
        possibleSpam: false,
        refreshedAt: new Date(),
        source: 'moralis',
        symbol: 'LGT',
      };

      const result = await queries.save('ethereum', '0x123', metadata);

      expect(result.isOk()).toBe(true);

      const retrieved = await queries.getByContract('ethereum', '0x123');
      expect(retrieved.isOk()).toBe(true);
      expect(retrieved._unsafeUnwrap()?.possibleSpam).toBe(false);
    });

    it('should insert metadata with verifiedContract true', async () => {
      const metadata: TokenMetadataRecord = {
        blockchain: 'ethereum',
        contractAddress: '0x123',
        name: 'Verified Token',
        refreshedAt: new Date(),
        source: 'moralis',
        symbol: 'VER',
        verifiedContract: true,
      };

      const result = await queries.save('ethereum', '0x123', metadata);

      expect(result.isOk()).toBe(true);

      const retrieved = await queries.getByContract('ethereum', '0x123');
      expect(retrieved.isOk()).toBe(true);
      expect(retrieved._unsafeUnwrap()?.verifiedContract).toBe(true);
    });

    it('should insert metadata with verifiedContract false', async () => {
      const metadata: TokenMetadataRecord = {
        blockchain: 'ethereum',
        contractAddress: '0x123',
        name: 'Unverified Token',
        refreshedAt: new Date(),
        source: 'moralis',
        symbol: 'UNV',
        verifiedContract: false,
      };

      const result = await queries.save('ethereum', '0x123', metadata);

      expect(result.isOk()).toBe(true);

      const retrieved = await queries.getByContract('ethereum', '0x123');
      expect(retrieved.isOk()).toBe(true);
      expect(retrieved._unsafeUnwrap()?.verifiedContract).toBe(false);
    });

    it('should insert metadata with all spam detection fields', async () => {
      const metadata: TokenMetadataRecord = {
        blockchain: 'ethereum',
        contractAddress: '0x123',
        name: 'Complete Token',
        possibleSpam: true,
        refreshedAt: new Date(),
        source: 'moralis',
        symbol: 'CMP',
        verifiedContract: false,
      };

      const result = await queries.save('ethereum', '0x123', metadata);

      expect(result.isOk()).toBe(true);

      const retrieved = await queries.getByContract('ethereum', '0x123');
      const record = retrieved._unsafeUnwrap();
      expect(record?.possibleSpam).toBe(true);
      expect(record?.verifiedContract).toBe(false);
    });

    it('should insert metadata with undefined spam detection fields', async () => {
      const metadata: TokenMetadataRecord = {
        blockchain: 'ethereum',
        contractAddress: '0x123',
        name: 'Token',
        refreshedAt: new Date(),
        source: 'moralis',
        symbol: 'TKN',
      };

      const result = await queries.save('ethereum', '0x123', metadata);

      expect(result.isOk()).toBe(true);

      const retrieved = await queries.getByContract('ethereum', '0x123');
      const record = retrieved._unsafeUnwrap();
      expect(record?.possibleSpam).toBeUndefined();
      expect(record?.verifiedContract).toBeUndefined();
    });
  });

  describe('save with additional metadata fields', () => {
    it('should insert metadata with description', async () => {
      const metadata: TokenMetadataRecord = {
        blockchain: 'ethereum',
        contractAddress: '0x123',
        description: 'A legitimate DeFi token',
        name: 'Token',
        refreshedAt: new Date(),
        source: 'moralis',
        symbol: 'TKN',
      };

      const result = await queries.save('ethereum', '0x123', metadata);

      expect(result.isOk()).toBe(true);

      const retrieved = await queries.getByContract('ethereum', '0x123');
      expect(retrieved._unsafeUnwrap()?.description).toBe('A legitimate DeFi token');
    });

    it('should insert metadata with externalUrl', async () => {
      const metadata: TokenMetadataRecord = {
        blockchain: 'ethereum',
        contractAddress: '0x123',
        externalUrl: 'https://example.com',
        name: 'Token',
        refreshedAt: new Date(),
        source: 'moralis',
        symbol: 'TKN',
      };

      const result = await queries.save('ethereum', '0x123', metadata);

      expect(result.isOk()).toBe(true);

      const retrieved = await queries.getByContract('ethereum', '0x123');
      expect(retrieved._unsafeUnwrap()?.externalUrl).toBe('https://example.com');
    });

    it('should insert metadata with totalSupply', async () => {
      const metadata: TokenMetadataRecord = {
        blockchain: 'ethereum',
        contractAddress: '0x123',
        name: 'Token',
        refreshedAt: new Date(),
        source: 'moralis',
        symbol: 'TKN',
        totalSupply: '1000000000000000000',
      };

      const result = await queries.save('ethereum', '0x123', metadata);

      expect(result.isOk()).toBe(true);

      const retrieved = await queries.getByContract('ethereum', '0x123');
      expect(retrieved._unsafeUnwrap()?.totalSupply).toBe('1000000000000000000');
    });

    it('should insert metadata with createdAt', async () => {
      const metadata: TokenMetadataRecord = {
        blockchain: 'ethereum',
        contractAddress: '0x123',
        createdAt: '2024-01-01T00:00:00Z',
        name: 'Token',
        refreshedAt: new Date(),
        source: 'moralis',
        symbol: 'TKN',
      };

      const result = await queries.save('ethereum', '0x123', metadata);

      expect(result.isOk()).toBe(true);

      const retrieved = await queries.getByContract('ethereum', '0x123');
      expect(retrieved._unsafeUnwrap()?.createdAt).toBe('2024-01-01T00:00:00Z');
    });

    it('should insert metadata with blockNumber', async () => {
      const metadata: TokenMetadataRecord = {
        blockchain: 'ethereum',
        blockNumber: 12345678,
        contractAddress: '0x123',
        name: 'Token',
        refreshedAt: new Date(),
        source: 'moralis',
        symbol: 'TKN',
      };

      const result = await queries.save('ethereum', '0x123', metadata);

      expect(result.isOk()).toBe(true);

      const retrieved = await queries.getByContract('ethereum', '0x123');
      expect(retrieved._unsafeUnwrap()?.blockNumber).toBe(12345678);
    });

    it('should insert complete metadata with all fields', async () => {
      const metadata: TokenMetadataRecord = {
        blockchain: 'ethereum',
        blockNumber: 12345678,
        contractAddress: '0x123',
        createdAt: '2024-01-01T00:00:00Z',
        decimals: 18,
        description: 'A complete token with all fields',
        externalUrl: 'https://example.com',
        logoUrl: 'https://example.com/logo.png',
        name: 'Complete Token',
        possibleSpam: false,
        refreshedAt: new Date(),
        source: 'moralis',
        symbol: 'CMP',
        totalSupply: '1000000000000000000',
        verifiedContract: true,
      };

      const result = await queries.save('ethereum', '0x123', metadata);

      expect(result.isOk()).toBe(true);

      const retrieved = await queries.getByContract('ethereum', '0x123');
      const record = retrieved._unsafeUnwrap();
      expect(record?.name).toBe('Complete Token');
      expect(record?.symbol).toBe('CMP');
      expect(record?.decimals).toBe(18);
      expect(record?.logoUrl).toBe('https://example.com/logo.png');
      expect(record?.possibleSpam).toBe(false);
      expect(record?.verifiedContract).toBe(true);
      expect(record?.description).toBe('A complete token with all fields');
      expect(record?.externalUrl).toBe('https://example.com');
      expect(record?.totalSupply).toBe('1000000000000000000');
      expect(record?.createdAt).toBe('2024-01-01T00:00:00Z');
      expect(record?.blockNumber).toBe(12345678);
    });
  });

  describe('save merging behavior with spam detection fields', () => {
    it('should preserve existing possibleSpam when updating with undefined', async () => {
      // Insert with possibleSpam true
      await queries.save('ethereum', '0x123', {
        blockchain: 'ethereum',
        contractAddress: '0x123',
        name: 'Token',
        possibleSpam: true,
        refreshedAt: new Date(),
        source: 'moralis',
        symbol: 'TKN',
      });

      // Update without possibleSpam (undefined)
      await queries.save('ethereum', '0x123', {
        blockchain: 'ethereum',
        contractAddress: '0x123',
        name: 'Updated Token',
        refreshedAt: new Date(),
        source: 'moralis',
        symbol: 'TKN',
      });

      const retrieved = await queries.getByContract('ethereum', '0x123');
      const record = retrieved._unsafeUnwrap();
      expect(record?.possibleSpam).toBe(true); // Should preserve original value
      expect(record?.name).toBe('Updated Token'); // Should update name
    });

    it('should override possibleSpam when explicitly set to false', async () => {
      // Insert with possibleSpam true
      await queries.save('ethereum', '0x123', {
        blockchain: 'ethereum',
        contractAddress: '0x123',
        name: 'Token',
        possibleSpam: true,
        refreshedAt: new Date(),
        source: 'moralis',
        symbol: 'TKN',
      });

      // Update with possibleSpam false
      await queries.save('ethereum', '0x123', {
        blockchain: 'ethereum',
        contractAddress: '0x123',
        name: 'Token',
        possibleSpam: false,
        refreshedAt: new Date(),
        source: 'moralis',
        symbol: 'TKN',
      });

      const retrieved = await queries.getByContract('ethereum', '0x123');
      expect(retrieved._unsafeUnwrap()?.possibleSpam).toBe(false);
    });

    it('should preserve existing verifiedContract when updating with undefined', async () => {
      // Insert with verifiedContract true
      await queries.save('ethereum', '0x123', {
        blockchain: 'ethereum',
        contractAddress: '0x123',
        name: 'Token',
        refreshedAt: new Date(),
        source: 'moralis',
        symbol: 'TKN',
        verifiedContract: true,
      });

      // Update without verifiedContract (undefined)
      await queries.save('ethereum', '0x123', {
        blockchain: 'ethereum',
        contractAddress: '0x123',
        name: 'Updated Token',
        refreshedAt: new Date(),
        source: 'moralis',
        symbol: 'TKN',
      });

      const retrieved = await queries.getByContract('ethereum', '0x123');
      expect(retrieved._unsafeUnwrap()?.verifiedContract).toBe(true);
    });

    it('should preserve all additional metadata fields when updating with undefined', async () => {
      // Insert with all fields
      await queries.save('ethereum', '0x123', {
        blockchain: 'ethereum',
        blockNumber: 12345678,
        contractAddress: '0x123',
        createdAt: '2024-01-01T00:00:00Z',
        description: 'Original description',
        externalUrl: 'https://example.com',
        name: 'Token',
        refreshedAt: new Date(),
        source: 'moralis',
        symbol: 'TKN',
        totalSupply: '1000000000000000000',
      });

      // Update without additional fields
      await queries.save('ethereum', '0x123', {
        blockchain: 'ethereum',
        contractAddress: '0x123',
        name: 'Updated Token',
        refreshedAt: new Date(),
        source: 'moralis',
        symbol: 'TKN',
      });

      const retrieved = await queries.getByContract('ethereum', '0x123');
      const record = retrieved._unsafeUnwrap();
      expect(record?.description).toBe('Original description');
      expect(record?.externalUrl).toBe('https://example.com');
      expect(record?.totalSupply).toBe('1000000000000000000');
      expect(record?.createdAt).toBe('2024-01-01T00:00:00Z');
      expect(record?.blockNumber).toBe(12345678);
    });
  });
});
