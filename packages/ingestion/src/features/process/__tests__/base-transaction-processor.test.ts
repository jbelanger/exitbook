import type { TokenMetadataRecord } from '@exitbook/core';
import { ok } from 'neverthrow';
import { describe, expect, test, vi } from 'vitest';

import type { ProcessingContext } from '../../../shared/types/processors.js';
import type { ITokenMetadataService } from '../../token-metadata/token-metadata-service.interface.js';
import { BaseTransactionProcessor } from '../base-transaction-processor.js';

// Concrete implementation for testing abstract base class
class TestProcessor extends BaseTransactionProcessor {
  constructor(tokenMetadataService?: ITokenMetadataService) {
    super('test-source', tokenMetadataService);
  }

  // Member testDetectScamForAsset helper
  public async testDetectScamForAsset(
    assetSymbol: string,
    contractAddress?: string,
    transactionContext?: { amount: number; isAirdrop: boolean }
  ) {
    return this.detectScamForAsset(assetSymbol, contractAddress, transactionContext);
  }

  protected processInternal(_normalizedData: unknown[], _context: ProcessingContext) {
    return Promise.resolve(ok([]));
  }
}

describe('BaseTransactionProcessor - Scam Detection', () => {
  const MOCK_CONTRACT = '0x1234567890123456789012345678901234567890';

  test('Tier 1: Detects scam via professional metadata flag', async () => {
    const mockMetadata: TokenMetadataRecord = {
      contractAddress: MOCK_CONTRACT,
      blockchain: 'ethereum',
      name: 'Phishing Token',
      symbol: 'SCAM',
      decimals: 18,
      possibleSpam: true,
      source: 'provider-api',
      refreshedAt: new Date(),
    };

    const mockService = {
      getOrFetch: vi.fn().mockResolvedValue(ok(mockMetadata)),
    } as unknown as ITokenMetadataService;

    const processor = new TestProcessor(mockService);
    const result = await processor.testDetectScamForAsset('SCAM', MOCK_CONTRACT);

    expect(result).toBeDefined();
    expect(result?.type).toBe('SCAM_TOKEN');
    expect(result?.severity).toBe('error');
    expect(result?.metadata?.detectionSource).toBe('professional');
  });

  test('Tier 2: Detects scam via pattern matching (gift emojis)', async () => {
    const mockMetadata: TokenMetadataRecord = {
      contractAddress: MOCK_CONTRACT,
      blockchain: 'ethereum',
      name: 'Free Airdrop 🎁',
      symbol: 'GIFT',
      decimals: 18,
      possibleSpam: false,
      source: 'provider-api',
      refreshedAt: new Date(),
    };

    const mockService = {
      getOrFetch: vi.fn().mockResolvedValue(ok(mockMetadata)),
    } as unknown as ITokenMetadataService;

    const processor = new TestProcessor(mockService);
    const result = await processor.testDetectScamForAsset('GIFT', MOCK_CONTRACT);

    expect(result).toBeDefined();
    expect(result?.type).toBe('SUSPICIOUS_AIRDROP'); // Warning severity - emojis alone don't confirm scam
    expect(result?.metadata?.indicators).toContain('Gift/drop emojis in token name');
  });

  test('Tier 3: Detects suspicious airdrop via heuristics', async () => {
    // Neutral metadata
    const mockMetadata: TokenMetadataRecord = {
      contractAddress: MOCK_CONTRACT,
      blockchain: 'ethereum',
      name: 'Meme Coin',
      symbol: 'MEME',
      decimals: 18,
      possibleSpam: false,
      source: 'provider-api',
      refreshedAt: new Date(),
      // createdAt: removed to prevent Age pattern detection
    };

    const mockService = {
      getOrFetch: vi.fn().mockResolvedValue(ok(mockMetadata)),
    } as unknown as ITokenMetadataService;

    const processor = new TestProcessor(mockService);

    // Context: Airdrop of > 0 amount
    const result = await processor.testDetectScamForAsset('MEME', MOCK_CONTRACT, {
      amount: 100,
      isAirdrop: true,
    });

    expect(result).toBeDefined();
    expect(result?.type).toBe('SUSPICIOUS_AIRDROP'); // Warning severity
    expect(result?.severity).toBe('warning');
    expect(result?.metadata?.detectionSource).toBe('heuristic');
  });

  test('Symbol Fallback: Detects scam via symbol when service missing', async () => {
    const processor = new TestProcessor(undefined); // No metadata service

    // Test detection via suspicious symbol
    const result = await processor.testDetectScamForAsset('www.fake-site.com');

    expect(result).toBeDefined();
    expect(result?.type).toBe('SCAM_TOKEN');
    expect(result?.metadata?.scamReason).toContain('URL/website pattern');
  });
});
