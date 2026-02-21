import type { SourceType, UniversalTransactionData } from '@exitbook/core';
import { type Currency, parseDecimal, type AssetMovement } from '@exitbook/core';
import type { TransactionQueries } from '@exitbook/data';
import type { Result } from 'neverthrow';
import { ok, err } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';

import type { TransactionLink } from '../../linking/types.js';
import type { TransactionLinkQueries } from '../../persistence/transaction-link-queries.js';
import { PriceEnrichmentService } from '../price-enrichment-service.js';

// Helper to create a mock TransactionQueries
function createMockTransactionRepository(): TransactionQueries {
  return {
    getTransactions: vi.fn(),
    updateMovementsWithPrices: vi.fn(),
  } as unknown as TransactionQueries;
}

// Helper to create a mock TransactionLinkQueries
function createMockLinkRepository(): TransactionLinkQueries {
  return {
    findAll: vi.fn().mockResolvedValue(ok([])), // Default: no links
  } as unknown as TransactionLinkQueries;
}

// Helper to create a mock UniversalTransactionData with typed movements
function createMockTransaction(
  id: number,
  sourceType: SourceType,
  sourceName: string,
  datetime: string,
  inflows: AssetMovement[],
  outflows: AssetMovement[]
): UniversalTransactionData {
  return {
    id: id,
    accountId: 1,
    source: sourceName,
    sourceType: sourceType,
    externalId: `tx-${id}`,
    status: 'success',
    datetime: datetime,
    timestamp: new Date(datetime).getTime(),
    movements: {
      inflows: inflows,
      outflows: outflows,
    },
    fees: [],
    operation: { category: 'trade', type: 'buy' },
    ...(sourceType === 'blockchain'
      ? {
          blockchain: {
            name: sourceName,
            transaction_hash: `mock-hash-${id}`,
            is_confirmed: true,
            block_height: 123456 + id,
          },
        }
      : {}),
  };
}

describe('PriceEnrichmentService', () => {
  describe('Stats and Reporting', () => {
    it('should only count transactions that actually got prices (not just attempted)', async () => {
      const mockRepo = createMockTransactionRepository();
      const mockLinkRepo = createMockLinkRepository();

      const service = new PriceEnrichmentService(mockRepo, mockLinkRepo);

      // Transaction 1: Can be enriched (USD trade)
      const tx1 = createMockTransaction(
        1,
        'exchange',
        'kraken',
        '2024-01-01T10:00:00Z',
        [
          {
            assetId: 'test:btc',
            assetSymbol: 'BTC' as Currency,
            grossAmount: parseDecimal('1'),
          },
        ],
        [
          {
            assetId: 'test:usd',
            assetSymbol: 'USD' as Currency,
            grossAmount: parseDecimal('50000'),
          },
        ]
      );

      // Transaction 2: Cannot be enriched (crypto-crypto, no price history)
      const tx2 = createMockTransaction(
        2,
        'exchange',
        'kraken',
        '2024-01-01T11:00:00Z',
        [
          {
            assetId: 'test:sol',
            assetSymbol: 'SOL' as Currency,
            grossAmount: parseDecimal('100'),
          },
        ],
        [
          {
            assetId: 'test:ada',
            assetSymbol: 'ADA' as Currency,
            grossAmount: parseDecimal('1000'),
          },
        ]
      );

      vi.mocked(mockRepo.getTransactions).mockResolvedValue(
        ok([tx1, tx2]) as Result<UniversalTransactionData[], Error>
      );

      vi.mocked(mockRepo.updateMovementsWithPrices).mockResolvedValue(ok() as Result<void, Error>);

      const result = await service.enrichPrices();

      expect(result.isOk()).toBe(true);
      // Should only count tx1, not tx2 (which has no prices)
      expect(result._unsafeUnwrap().transactionsUpdated).toBe(1);

      // Verify only tx1 was updated
      expect(mockRepo.updateMovementsWithPrices).toHaveBeenCalledTimes(1);
      const firstCall = vi.mocked(mockRepo.updateMovementsWithPrices).mock.calls[0];
      expect(firstCall).toBeDefined();
      if (firstCall) {
        const tx = firstCall[0];
        expect(tx.id).toBe(1);
      }
    });

    it('should return 0 when database is empty', async () => {
      const mockRepo = createMockTransactionRepository();
      const mockLinkRepo = createMockLinkRepository();

      const service = new PriceEnrichmentService(mockRepo, mockLinkRepo);

      vi.mocked(mockRepo.getTransactions).mockResolvedValue(ok([]) as Result<UniversalTransactionData[], Error>);

      const result = await service.enrichPrices();

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().transactionsUpdated).toBe(0);

      // Should check for all transactions but find none
      expect(mockRepo.getTransactions).toHaveBeenCalled();
      expect(mockRepo.updateMovementsWithPrices).not.toHaveBeenCalled();
    });
  });

  describe('Failure Paths and Error Handling', () => {
    it('should handle database errors when getting all transactions', async () => {
      const mockRepo = createMockTransactionRepository();
      const mockLinkRepo = createMockLinkRepository();

      const service = new PriceEnrichmentService(mockRepo, mockLinkRepo);

      vi.mocked(mockRepo.getTransactions).mockResolvedValue(err(new Error('Database connection failed')));

      const result = await service.enrichPrices();

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toBe('Database connection failed');
    });

    it('should handle database errors when fetching confirmed links', async () => {
      const mockRepo = createMockTransactionRepository();
      const mockLinkRepo = createMockLinkRepository();

      const service = new PriceEnrichmentService(mockRepo, mockLinkRepo);

      vi.mocked(mockRepo.getTransactions).mockResolvedValue(
        ok([createMockTransaction(1, 'exchange', 'kraken', '2024-01-01T10:00:00Z', [], [])]) as Result<
          UniversalTransactionData[],
          Error
        >
      );

      vi.mocked(mockLinkRepo.findAll).mockResolvedValue(err(new Error('Failed to fetch links')));

      const result = await service.enrichPrices();

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toBe('Failed to fetch links');
    });

    it('should continue processing other exchanges if one fails', async () => {
      const mockRepo = createMockTransactionRepository();
      const mockLinkRepo = createMockLinkRepository();

      const service = new PriceEnrichmentService(mockRepo, mockLinkRepo);

      // Kraken transaction (will succeed)
      const tx1 = createMockTransaction(
        1,
        'exchange',
        'kraken',
        '2024-01-01T10:00:00Z',
        [
          {
            assetId: 'test:btc',
            assetSymbol: 'BTC' as Currency,
            grossAmount: parseDecimal('1'),
          },
        ],
        [
          {
            assetId: 'test:usd',
            assetSymbol: 'USD' as Currency,
            grossAmount: parseDecimal('50000'),
          },
        ]
      );

      // KuCoin transaction (will fail)
      const tx2 = createMockTransaction(
        2,
        'exchange',
        'kucoin',
        '2024-01-01T10:00:00Z',
        [
          {
            assetId: 'test:eth',
            assetSymbol: 'ETH' as Currency,
            grossAmount: parseDecimal('20'),
          },
        ],
        [
          {
            assetId: 'test:usd',
            assetSymbol: 'USD' as Currency,
            grossAmount: parseDecimal('60000'),
          },
        ]
      );

      vi.mocked(mockRepo.getTransactions).mockResolvedValue(
        ok([tx1, tx2]) as Result<UniversalTransactionData[], Error>
      );

      // First call (kraken) succeeds, second call (kucoin) fails
      vi.mocked(mockRepo.updateMovementsWithPrices)
        .mockResolvedValueOnce(ok() as Result<void, Error>)
        .mockResolvedValueOnce(err(new Error('Update failed')));

      const result = await service.enrichPrices();

      // Should still return ok with partial results
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().transactionsUpdated).toBe(1); // Only kraken succeeded
    });
  });

  describe('Price Propagation Across Links', () => {
    it('should propagate prices from exchange withdrawal to blockchain deposit', async () => {
      const mockRepo = createMockTransactionRepository();
      const mockLinkRepo = createMockLinkRepository();

      const service = new PriceEnrichmentService(mockRepo, mockLinkRepo);

      const baseTime = new Date('2024-01-01T10:00:00Z');

      // Step 1: Buy BTC on Kraken at $50,000
      const tx1Buy = createMockTransaction(
        1,
        'exchange',
        'kraken',
        baseTime.toISOString(),
        [{ assetId: 'test:btc', assetSymbol: 'BTC' as Currency, grossAmount: parseDecimal('1') }],
        [{ assetId: 'test:usdt', assetSymbol: 'USDT' as Currency, grossAmount: parseDecimal('50000') }]
      );

      // Step 2: Withdraw BTC from Kraken (has price from trade)
      const tx2Withdrawal = createMockTransaction(
        2,
        'exchange',
        'kraken',
        new Date(baseTime.getTime() + 60000).toISOString(), // 1 minute later
        [],
        [
          {
            assetId: 'test:btc',
            assetSymbol: 'BTC' as Currency,
            grossAmount: parseDecimal('1'),
            priceAtTxTime: {
              price: { amount: parseDecimal('50000'), currency: 'USD' as Currency },
              source: 'derived-history',
              fetchedAt: new Date(baseTime.getTime()),
              granularity: 'exact',
            },
          },
        ]
      );

      // Step 3: Bitcoin deposit (will get price from withdrawal via link propagation)
      const tx3Deposit = createMockTransaction(
        3,
        'blockchain',
        'bitcoin',
        new Date(baseTime.getTime() + 120000).toISOString(), // 2 minutes later
        [{ assetId: 'test:btc', assetSymbol: 'BTC' as Currency, grossAmount: parseDecimal('0.999') }], // Slightly less due to network fee
        []
      );

      // Create confirmed link: withdrawal → deposit
      const link = {
        id: 'link-1',
        sourceTransactionId: 2,
        targetTransactionId: 3,
        linkType: 'exchange_to_blockchain' as const,
        confidenceScore: parseDecimal('0.95'),
        matchCriteria: {
          assetMatch: true,
          amountSimilarity: parseDecimal('0.999'),
          timingValid: true,
          timingHours: 0.033,
        },
        status: 'confirmed' as const,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // All transactions are processed, but only deposit needs price updates
      // (withdrawal already has a price)
      vi.mocked(mockRepo.getTransactions).mockResolvedValue(
        ok([tx1Buy, tx2Withdrawal, tx3Deposit]) as Result<UniversalTransactionData[], Error>
      );
      vi.mocked(mockLinkRepo.findAll).mockResolvedValue(ok([link]) as Result<TransactionLink[], Error>);
      vi.mocked(mockRepo.updateMovementsWithPrices).mockResolvedValue(ok() as Result<void, Error>);

      const result = await service.enrichPrices();

      expect(result.isOk()).toBe(true);
      // 1 transaction updated: the Bitcoin deposit gets price from link propagation
      expect(result._unsafeUnwrap().transactionsUpdated).toBe(1);

      // Verify Bitcoin deposit got price from linked Kraken withdrawal
      const depositCalls = vi.mocked(mockRepo.updateMovementsWithPrices).mock.calls.filter((call) => call[0].id === 3);
      expect(depositCalls.length).toBeGreaterThan(0);
      expect(depositCalls[0]![0].movements.inflows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            assetSymbol: 'BTC' as Currency,
            priceAtTxTime: expect.objectContaining({
              source: 'link-propagated',
            }) as Partial<AssetMovement['priceAtTxTime']>,
          }),
        ])
      );
    });

    it('should only use confirmed links, not suggested or rejected', async () => {
      const mockRepo = createMockTransactionRepository();
      const mockLinkRepo = createMockLinkRepository();

      const service = new PriceEnrichmentService(mockRepo, mockLinkRepo);

      const baseTime = new Date('2024-01-01T10:00:00Z');

      const tx1 = createMockTransaction(
        1,
        'exchange',
        'kraken',
        baseTime.toISOString(),
        [{ assetId: 'test:btc', assetSymbol: 'BTC' as Currency, grossAmount: parseDecimal('1') }],
        [{ assetId: 'test:usdt', assetSymbol: 'USDT' as Currency, grossAmount: parseDecimal('50000') }]
      );

      const tx2 = createMockTransaction(
        2,
        'blockchain',
        'bitcoin',
        new Date(baseTime.getTime() + 60000).toISOString(),
        [{ assetId: 'test:btc', assetSymbol: 'BTC' as Currency, grossAmount: parseDecimal('0.999') }],
        []
      );

      // Suggested link (should be ignored)
      const suggestedLink = {
        id: 'link-1',
        sourceTransactionId: 1,
        targetTransactionId: 2,
        linkType: 'exchange_to_blockchain' as const,
        confidenceScore: parseDecimal('0.85'),
        matchCriteria: {
          assetMatch: true,
          amountSimilarity: parseDecimal('0.999'),
          timingValid: true,
          timingHours: 0.017,
        },
        status: 'suggested' as const,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      vi.mocked(mockRepo.getTransactions).mockResolvedValue(
        ok([tx1, tx2]) as Result<UniversalTransactionData[], Error>
      );
      vi.mocked(mockLinkRepo.findAll).mockResolvedValue(ok([suggestedLink]) as Result<TransactionLink[], Error>);
      vi.mocked(mockRepo.updateMovementsWithPrices).mockResolvedValue(ok() as Result<void, Error>);

      const result = await service.enrichPrices();

      expect(result.isOk()).toBe(true);
      // Should not propagate price from suggested link
      expect(result._unsafeUnwrap().transactionsUpdated).toBe(0);
    });
  });

  describe('Edge Cases', () => {
    it('should handle transactions with null movements', async () => {
      const mockRepo = createMockTransactionRepository();
      const mockLinkRepo = createMockLinkRepository();

      const service = new PriceEnrichmentService(mockRepo, mockLinkRepo);

      const tx1 = createMockTransaction(1, 'exchange', 'kraken', '2024-01-01T10:00:00Z', [], []);

      vi.mocked(mockRepo.getTransactions).mockResolvedValue(ok([tx1]) as Result<UniversalTransactionData[], Error>);

      const result = await service.enrichPrices();

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().transactionsUpdated).toBe(0);
    });
  });
});
