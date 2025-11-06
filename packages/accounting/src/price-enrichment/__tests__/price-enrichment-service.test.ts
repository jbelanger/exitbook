/* eslint-disable @typescript-eslint/unbound-method -- Acceptable for tests */

import type { SourceType, UniversalTransaction } from '@exitbook/core';
import { Currency, parseDecimal, type AssetMovement } from '@exitbook/core';
import type { TransactionRepository } from '@exitbook/data';
import type { Result } from 'neverthrow';
import { ok, err } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';

import type { TransactionLink } from '../../linking/types.js';
import type { TransactionLinkRepository } from '../../persistence/transaction-link-repository.js';
import { PriceEnrichmentService } from '../price-enrichment-service.js';

// Helper to create a mock TransactionRepository
function createMockTransactionRepository(): TransactionRepository {
  return {
    findTransactionsNeedingPrices: vi.fn(),
    getTransactions: vi.fn(),
    updateMovementsWithPrices: vi.fn(),
  } as unknown as TransactionRepository;
}

// Helper to create a mock TransactionLinkRepository
function createMockLinkRepository(): TransactionLinkRepository {
  return {
    findAll: vi.fn().mockResolvedValue(ok([])), // Default: no links
  } as unknown as TransactionLinkRepository;
}

// Helper to create a mock UniversalTransaction with typed movements
function createMockTransaction(
  id: number,
  sourceType: SourceType,
  sourceId: string,
  datetime: string,
  inflows: AssetMovement[],
  outflows: AssetMovement[]
): UniversalTransaction {
  return {
    id: id,
    source: sourceId,
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
            name: sourceId,
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
            asset: 'BTC',
            grossAmount: parseDecimal('1'),
          },
        ],
        [
          {
            asset: 'USD',
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
            asset: 'SOL',
            grossAmount: parseDecimal('100'),
          },
        ],
        [
          {
            asset: 'ADA',
            grossAmount: parseDecimal('1000'),
          },
        ]
      );

      vi.mocked(mockRepo.findTransactionsNeedingPrices).mockResolvedValue(
        ok([tx1, tx2]) as Result<UniversalTransaction[], Error>
      );

      vi.mocked(mockRepo.getTransactions).mockResolvedValue(ok([tx1, tx2]) as Result<UniversalTransaction[], Error>);

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

      vi.mocked(mockRepo.findTransactionsNeedingPrices).mockResolvedValue(
        ok([]) as Result<UniversalTransaction[], Error>
      );
      vi.mocked(mockRepo.getTransactions).mockResolvedValue(ok([]) as Result<UniversalTransaction[], Error>);

      const result = await service.enrichPrices();

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().transactionsUpdated).toBe(0);

      // Should check for all transactions but find none
      expect(mockRepo.getTransactions).toHaveBeenCalled();
      expect(mockRepo.updateMovementsWithPrices).not.toHaveBeenCalled();
    });
  });

  describe('Failure Paths and Error Handling', () => {
    it('should handle database errors when finding transactions', async () => {
      const mockRepo = createMockTransactionRepository();
      const mockLinkRepo = createMockLinkRepository();

      const service = new PriceEnrichmentService(mockRepo, mockLinkRepo);

      vi.mocked(mockRepo.findTransactionsNeedingPrices).mockResolvedValue(err(new Error('Database connection failed')));

      const result = await service.enrichPrices();

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toBe('Database connection failed');
    });

    it('should handle database errors when getting all transactions', async () => {
      const mockRepo = createMockTransactionRepository();
      const mockLinkRepo = createMockLinkRepository();

      const service = new PriceEnrichmentService(mockRepo, mockLinkRepo);

      vi.mocked(mockRepo.findTransactionsNeedingPrices).mockResolvedValue(
        ok([createMockTransaction(1, 'exchange', 'kraken', '2024-01-01T10:00:00Z', [], [])]) as Result<
          UniversalTransaction[],
          Error
        >
      );

      vi.mocked(mockRepo.getTransactions).mockResolvedValue(err(new Error('Failed to fetch transactions')));

      const result = await service.enrichPrices();

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toBe('Failed to fetch transactions');
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
            asset: 'BTC',
            grossAmount: parseDecimal('1'),
          },
        ],
        [
          {
            asset: 'USD',
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
            asset: 'ETH',
            grossAmount: parseDecimal('20'),
          },
        ],
        [
          {
            asset: 'USD',
            grossAmount: parseDecimal('60000'),
          },
        ]
      );

      vi.mocked(mockRepo.findTransactionsNeedingPrices).mockResolvedValue(
        ok([tx1, tx2]) as Result<UniversalTransaction[], Error>
      );

      vi.mocked(mockRepo.getTransactions).mockResolvedValue(ok([tx1, tx2]) as Result<UniversalTransaction[], Error>);

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
        [{ asset: 'BTC', grossAmount: parseDecimal('1') }],
        [{ asset: 'USDT', grossAmount: parseDecimal('50000') }]
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
            asset: 'BTC',
            grossAmount: parseDecimal('1'),
            priceAtTxTime: {
              price: { amount: parseDecimal('50000'), currency: Currency.create('USD') },
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
        [{ asset: 'BTC', grossAmount: parseDecimal('0.999') }], // Slightly less due to network fee
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
      vi.mocked(mockRepo.findTransactionsNeedingPrices).mockResolvedValue(
        ok([tx3Deposit]) as Result<UniversalTransaction[], Error>
      );
      vi.mocked(mockRepo.getTransactions).mockResolvedValue(
        ok([tx1Buy, tx2Withdrawal, tx3Deposit]) as Result<UniversalTransaction[], Error>
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
            asset: 'BTC',
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
        [{ asset: 'BTC', grossAmount: parseDecimal('1') }],
        [{ asset: 'USDT', grossAmount: parseDecimal('50000') }]
      );

      const tx2 = createMockTransaction(
        2,
        'blockchain',
        'bitcoin',
        new Date(baseTime.getTime() + 60000).toISOString(),
        [{ asset: 'BTC', grossAmount: parseDecimal('0.999') }],
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

      vi.mocked(mockRepo.findTransactionsNeedingPrices).mockResolvedValue(
        ok([tx2]) as Result<UniversalTransaction[], Error>
      );
      vi.mocked(mockRepo.getTransactions).mockResolvedValue(ok([tx1, tx2]) as Result<UniversalTransaction[], Error>);
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

      vi.mocked(mockRepo.findTransactionsNeedingPrices).mockResolvedValue(
        ok([tx1]) as Result<UniversalTransaction[], Error>
      );

      vi.mocked(mockRepo.getTransactions).mockResolvedValue(ok([tx1]) as Result<UniversalTransaction[], Error>);

      const result = await service.enrichPrices();

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().transactionsUpdated).toBe(0);
    });
  });
});
