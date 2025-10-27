/* eslint-disable unicorn/no-useless-undefined -- acceptable for tests */
/* eslint-disable @typescript-eslint/unbound-method -- acceptable for tests */
import type { TokenMetadataRecord } from '@exitbook/core';
import type { TokenMetadataRepository } from '@exitbook/data';
import type { BlockchainProviderManager, IBlockchainProvider } from '@exitbook/providers';
import { ProviderError } from '@exitbook/providers';
import { err, ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  enrichTokenMetadataBatch,
  getOrFetchTokenMetadata,
  looksLikeContractAddress,
  needsEnrichment,
} from '../token-metadata-utils.js';

describe('token-metadata-utils', () => {
  describe('getOrFetchTokenMetadata', () => {
    let mockRepository: TokenMetadataRepository;
    let mockProviderManager: BlockchainProviderManager;

    beforeEach(() => {
      mockRepository = {
        getByContract: vi.fn(),
        save: vi.fn(),
        isStale: vi.fn(),
        refreshInBackground: vi.fn(),
      } as unknown as TokenMetadataRepository;

      mockProviderManager = {
        getProviders: vi.fn(),
        executeWithFailover: vi.fn(),
      } as unknown as BlockchainProviderManager;
    });

    it('should return cached metadata if found and fresh', async () => {
      const mockMetadata: TokenMetadataRecord = {
        contractAddress: '0x123',
        symbol: 'TEST',
        decimals: 18,
        refreshedAt: new Date(),
        source: 'test-source',
        blockchain: 'ethereum',
      };

      vi.mocked(mockRepository.getByContract).mockResolvedValue(ok(mockMetadata));
      vi.mocked(mockRepository.isStale).mockReturnValue(false);

      const result = await getOrFetchTokenMetadata('ethereum', '0x123', mockRepository, mockProviderManager);

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toEqual(mockMetadata);
      expect(mockRepository.getByContract).toHaveBeenCalledWith('ethereum', '0x123');
      expect(mockProviderManager.executeWithFailover).not.toHaveBeenCalled();
    });

    it('should trigger background refresh if cached metadata is stale', async () => {
      const mockMetadata: TokenMetadataRecord = {
        contractAddress: '0x123',
        symbol: 'TEST',
        decimals: 18,
        refreshedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000), // 8 days ago
        source: 'test-source',
        blockchain: 'ethereum',
      };

      vi.mocked(mockRepository.getByContract).mockResolvedValue(ok(mockMetadata));
      vi.mocked(mockRepository.isStale).mockReturnValue(true);

      const result = await getOrFetchTokenMetadata('ethereum', '0x123', mockRepository, mockProviderManager);

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toEqual(mockMetadata);
      expect(mockRepository.refreshInBackground).toHaveBeenCalledWith('ethereum', '0x123', expect.any(Function));
    });

    it('should fetch from provider if not in cache', async () => {
      const mockMetadata: TokenMetadataRecord = {
        contractAddress: '0x123',
        symbol: 'TEST',
        decimals: 18,
        refreshedAt: new Date(),
        source: 'test-source',
        blockchain: 'ethereum',
      };

      vi.mocked(mockRepository.getByContract).mockResolvedValue(ok(undefined));
      vi.mocked(mockProviderManager.getProviders).mockReturnValue([
        {
          capabilities: {
            supportedOperations: ['getTokenMetadata'],
          },
        },
      ] as IBlockchainProvider[]);
      vi.mocked(mockProviderManager.executeWithFailover).mockResolvedValue(
        ok({
          data: mockMetadata,
          providerName: 'test-provider',
        })
      );
      vi.mocked(mockRepository.save).mockResolvedValue(ok());

      const result = await getOrFetchTokenMetadata('ethereum', '0x123', mockRepository, mockProviderManager);

      expect(result.isOk()).toBe(true);
      const returnedMetadata = result._unsafeUnwrap();
      // Should populate refreshedAt even if provider didn't return it
      expect(returnedMetadata).toMatchObject({
        contractAddress: '0x123',
        symbol: 'TEST',
        decimals: 18,
      });
      expect(returnedMetadata?.refreshedAt).toBeInstanceOf(Date);
      expect(mockProviderManager.executeWithFailover).toHaveBeenCalledWith('ethereum', {
        type: 'getTokenMetadata',
        contractAddress: '0x123',
      });
      // Should save complete metadata with refreshedAt
      expect(mockRepository.save).toHaveBeenCalledWith(
        'ethereum',
        '0x123',
        expect.objectContaining({
          contractAddress: '0x123',
          symbol: 'TEST',
          decimals: 18,
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- acceptable in tests
          refreshedAt: expect.any(Date),
        })
      );
    });

    it('should return undefined if provider does not support metadata', async () => {
      vi.mocked(mockRepository.getByContract).mockResolvedValue(ok(undefined));
      vi.mocked(mockProviderManager.executeWithFailover).mockResolvedValue(
        err(new ProviderError('No providers available for ethereum operation: getTokenMetadata', 'NO_PROVIDERS'))
      );

      const result = await getOrFetchTokenMetadata('ethereum', '0x123', mockRepository, mockProviderManager);

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBeUndefined();
      expect(mockProviderManager.executeWithFailover).toHaveBeenCalledWith('ethereum', {
        type: 'getTokenMetadata',
        contractAddress: '0x123',
      });
    });

    it('should return fetched metadata even if cache save fails', async () => {
      const mockMetadata: TokenMetadataRecord = {
        contractAddress: '0x123',
        symbol: 'TEST',
        decimals: 18,
        refreshedAt: new Date(),
        source: 'test-source',
        blockchain: 'ethereum',
      };

      vi.mocked(mockRepository.getByContract).mockResolvedValue(ok(undefined));
      vi.mocked(mockProviderManager.getProviders).mockReturnValue([
        {
          capabilities: {
            supportedOperations: ['getTokenMetadata'],
          },
        },
      ] as IBlockchainProvider[]);
      vi.mocked(mockProviderManager.executeWithFailover).mockResolvedValue(
        ok({
          data: mockMetadata,
          providerName: 'test-provider',
        })
      );
      vi.mocked(mockRepository.save).mockResolvedValue(err(new Error('Save failed')));

      const result = await getOrFetchTokenMetadata('ethereum', '0x123', mockRepository, mockProviderManager);

      expect(result.isOk()).toBe(true);
      const returnedMetadata = result._unsafeUnwrap();
      // Should still return complete metadata with refreshedAt even if save failed
      expect(returnedMetadata).toMatchObject({
        contractAddress: '0x123',
        symbol: 'TEST',
        decimals: 18,
      });
      expect(returnedMetadata?.refreshedAt).toBeInstanceOf(Date);
    });

    it('should return error if cache check fails', async () => {
      vi.mocked(mockRepository.getByContract).mockResolvedValue(err(new Error('Cache error')));

      const result = await getOrFetchTokenMetadata('ethereum', '0x123', mockRepository, mockProviderManager);

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toContain('Cache error');
    });

    it('should return error if provider fetch fails', async () => {
      vi.mocked(mockRepository.getByContract).mockResolvedValue(ok(undefined));
      vi.mocked(mockProviderManager.getProviders).mockReturnValue([
        {
          capabilities: {
            supportedOperations: ['getTokenMetadata'],
          },
        },
      ] as IBlockchainProvider[]);
      vi.mocked(mockProviderManager.executeWithFailover).mockResolvedValue(
        err(new ProviderError('Fetch failed', 'ALL_PROVIDERS_FAILED'))
      );

      const result = await getOrFetchTokenMetadata('ethereum', '0x123', mockRepository, mockProviderManager);

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toContain('Fetch failed');
    });
  });

  describe('enrichTokenMetadataBatch', () => {
    let mockRepository: TokenMetadataRepository;
    let mockProviderManager: BlockchainProviderManager;

    beforeEach(() => {
      mockRepository = {
        getByContract: vi.fn(),
        save: vi.fn(),
        isStale: vi.fn(),
        refreshInBackground: vi.fn(),
      } as unknown as TokenMetadataRepository;

      mockProviderManager = {
        getProviders: vi.fn(),
        executeWithFailover: vi.fn(),
      } as unknown as BlockchainProviderManager;
    });

    it('should enrich multiple items with token metadata', async () => {
      interface TestItem {
        contractAddress?: string | undefined;
        symbol?: string | undefined;
        decimals?: number | undefined;
      }

      const items: TestItem[] = [
        { contractAddress: '0x123' },
        { contractAddress: '0x456' },
        { contractAddress: '0x123' }, // Duplicate - should only fetch once
      ];

      const metadata1: TokenMetadataRecord = {
        contractAddress: '0x123',
        symbol: 'TEST1',
        decimals: 18,
        refreshedAt: new Date(),
        source: 'test-source',
        blockchain: 'ethereum',
      };

      const metadata2: TokenMetadataRecord = {
        contractAddress: '0x456',
        symbol: 'TEST2',
        decimals: 6,
        refreshedAt: new Date(),
        source: 'test-source',
        blockchain: 'ethereum',
      };

      vi.mocked(mockRepository.getByContract).mockImplementation((_blockchain, address) => {
        if (address === '0x123') return Promise.resolve(ok(metadata1));
        if (address === '0x456') return Promise.resolve(ok(metadata2));
        return Promise.resolve(ok(undefined));
      });
      vi.mocked(mockRepository.isStale).mockReturnValue(false);

      const result = await enrichTokenMetadataBatch(
        items,
        'ethereum',
        (item) => item.contractAddress,
        (item, metadata) => {
          item.symbol = metadata.symbol;
          item.decimals = metadata.decimals;
        },
        mockRepository,
        mockProviderManager
      );

      expect(result.isOk()).toBe(true);
      expect(items[0]).toMatchObject({ symbol: 'TEST1', decimals: 18 });
      expect(items[1]).toMatchObject({ symbol: 'TEST2', decimals: 6 });
      expect(items[2]).toMatchObject({ symbol: 'TEST1', decimals: 18 });

      // Should only fetch unique contracts
      expect(mockRepository.getByContract).toHaveBeenCalledTimes(2);
    });

    it('should handle items without contract addresses', async () => {
      interface TestItem {
        contractAddress?: string | undefined;
        symbol?: string | undefined;
      }

      const items: TestItem[] = [{ symbol: 'ETH' }, { symbol: 'BTC' }];

      const result = await enrichTokenMetadataBatch(
        items,
        'ethereum',
        (item) => item.contractAddress,
        (item, metadata) => {
          item.symbol = metadata.symbol;
        },
        mockRepository,
        mockProviderManager
      );

      expect(result.isOk()).toBe(true);
      expect(mockRepository.getByContract).not.toHaveBeenCalled();
    });

    it('should continue enriching other items if one fails', async () => {
      interface TestItem {
        contractAddress?: string;
        symbol?: string | undefined;
      }

      const items: TestItem[] = [{ contractAddress: '0x123' }, { contractAddress: '0x456' }];

      const metadata2: TokenMetadataRecord = {
        contractAddress: '0x456',
        symbol: 'TEST2',
        decimals: 6,
        refreshedAt: new Date(),
        source: 'test-source',
        blockchain: 'ethereum',
      };

      vi.mocked(mockRepository.getByContract).mockImplementation((_blockchain, address) => {
        if (address === '0x123') return Promise.resolve(err(new Error('Fetch failed')));
        if (address === '0x456') return Promise.resolve(ok(metadata2));
        return Promise.resolve(ok(undefined));
      });

      const result = await enrichTokenMetadataBatch(
        items,
        'ethereum',
        (item) => item.contractAddress,
        (item, metadata) => {
          item.symbol = metadata.symbol;
        },
        mockRepository,
        mockProviderManager
      );

      expect(result.isOk()).toBe(true);
      expect(items[0]?.symbol).toBeUndefined(); // Failed to enrich
      expect(items[1]).toMatchObject({ symbol: 'TEST2' }); // Successfully enriched
    });
  });

  describe('needsEnrichment', () => {
    it('should return true if symbol is missing', () => {
      expect(needsEnrichment(undefined, 18)).toBe(true);
    });

    it('should return true if decimals is missing', () => {
      expect(needsEnrichment('TEST')).toBe(true);
    });

    it('should return true if both are missing', () => {
      expect(needsEnrichment()).toBe(true);
    });

    it('should return false if both are present', () => {
      expect(needsEnrichment('TEST', 18)).toBe(false);
    });
  });

  describe('looksLikeContractAddress', () => {
    it('should identify Solana mint addresses', () => {
      expect(looksLikeContractAddress('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')).toBe(true);
    });

    it('should identify EVM contract addresses', () => {
      expect(looksLikeContractAddress('0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', 40)).toBe(true);
    });

    it('should reject human-readable symbols', () => {
      expect(looksLikeContractAddress('USDC')).toBe(false);
      expect(looksLikeContractAddress('BTC')).toBe(false);
      expect(looksLikeContractAddress('ETH')).toBe(false);
    });

    it('should reject short strings', () => {
      expect(looksLikeContractAddress('abc123')).toBe(false);
    });

    it('should handle mixed case readable tokens', () => {
      expect(looksLikeContractAddress('WrapedETH')).toBe(false);
    });
  });
});
