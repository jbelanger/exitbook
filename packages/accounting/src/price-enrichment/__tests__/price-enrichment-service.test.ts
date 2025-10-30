/* eslint-disable @typescript-eslint/no-unsafe-argument -- Acceptable for tests */
/* eslint-disable @typescript-eslint/unbound-method -- Acceptable for tests */
/* eslint-disable @typescript-eslint/no-explicit-any -- Acceptable for test mocks */

import type { SourceType, UniversalTransaction } from '@exitbook/core';
import { parseDecimal, type AssetMovement } from '@exitbook/core';
import type { TransactionRepository } from '@exitbook/data';
import { ok, err } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';

import type { TransactionLinkRepository } from '../../persistence/transaction-link-repository.js';
import { PriceEnrichmentService } from '../price-enrichment-service.ts';

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

// Helper to create a mock StoredTransaction with typed movements
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
    fees: {},
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
  describe('Happy Path: Exchange Trades', () => {
    it('should apply exchange-execution prices directly to fiat/stable trades (Pass 0)', async () => {
      const mockRepo = createMockTransactionRepository();
      const mockLinkRepo = createMockLinkRepository();

      const service = new PriceEnrichmentService(mockRepo, mockLinkRepo);

      // Transaction: Buy 1 BTC with 50,000 USDT
      const tx1 = createMockTransaction(
        1,
        'exchange',
        'kraken',
        '2024-01-01T10:00:00Z',
        [
          {
            asset: 'BTC',
            amount: parseDecimal('1'),
          },
        ],
        [
          {
            asset: 'USDT',
            amount: parseDecimal('50000'),
          },
        ]
      );

      vi.mocked(mockRepo.findTransactionsNeedingPrices).mockResolvedValue(ok([tx1]) as any);

      vi.mocked(mockRepo.getTransactions).mockResolvedValue(ok([tx1]) as any);

      vi.mocked(mockRepo.updateMovementsWithPrices).mockResolvedValue(ok() as any);

      const result = await service.enrichPrices();

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toEqual({ transactionsUpdated: 1 });

      // Verify that updateMovementsWithPrices was called with exchange-execution source
      expect(mockRepo.updateMovementsWithPrices).toHaveBeenCalledWith(
        1,
        expect.arrayContaining([
          expect.objectContaining({
            asset: 'BTC',
            source: 'exchange-execution',
            granularity: 'exact',
          }),
        ])
      );
    });

    it('should process multiple exchanges independently', async () => {
      const mockRepo = createMockTransactionRepository();
      const mockLinkRepo = createMockLinkRepository();

      const service = new PriceEnrichmentService(mockRepo, mockLinkRepo);

      const baseTime = new Date('2024-01-01T10:00:00Z');

      // Kraken: BTC = 50,000 USDT
      const tx1 = createMockTransaction(
        1,
        'exchange',
        'kraken',
        baseTime.toISOString(),
        [
          {
            asset: 'BTC',
            amount: parseDecimal('1'),
          },
        ],
        [
          {
            asset: 'USDT',
            amount: parseDecimal('50000'),
          },
        ]
      );

      // KuCoin: BTC = 50,100 USDT (different price!)
      const tx2 = createMockTransaction(
        2,
        'exchange',
        'kucoin',
        baseTime.toISOString(),
        [
          {
            asset: 'BTC',
            amount: parseDecimal('1'),
          },
        ],
        [
          {
            asset: 'USDT',
            amount: parseDecimal('50100'),
          },
        ]
      );

      vi.mocked(mockRepo.findTransactionsNeedingPrices).mockResolvedValue(ok([tx1, tx2]) as any);

      vi.mocked(mockRepo.getTransactions).mockResolvedValue(ok([tx1, tx2]) as any);

      vi.mocked(mockRepo.updateMovementsWithPrices).mockResolvedValue(ok() as any);

      const result = await service.enrichPrices();

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().transactionsUpdated).toBe(2);

      // Verify each exchange got its own price
      const tx1Calls = vi.mocked(mockRepo.updateMovementsWithPrices).mock.calls.filter((call) => call[0] === 1);
      expect(tx1Calls[0]![1][0]!.price.amount.toFixed()).toBe('50000');

      const tx2Calls = vi.mocked(mockRepo.updateMovementsWithPrices).mock.calls.filter((call) => call[0] === 2);
      expect(tx2Calls[0]![1][0]!.price.amount.toFixed()).toBe('50100');
    });
  });

  describe('Happy Path: Blockchain Transactions', () => {
    it('should enrich simple stablecoin swaps on blockchain', async () => {
      const mockRepo = createMockTransactionRepository();
      const mockLinkRepo = createMockLinkRepository();

      const service = new PriceEnrichmentService(mockRepo, mockLinkRepo);

      // Blockchain swap: 1000 USDT for 0.5 BTC on Uniswap
      const tx1 = createMockTransaction(
        1,
        'blockchain',
        'ethereum',
        '2024-01-01T10:00:00Z',
        [
          {
            asset: 'BTC',
            amount: parseDecimal('0.5'),
          },
        ],
        [
          {
            asset: 'USDT',
            amount: parseDecimal('25000'),
          },
        ]
      );

      vi.mocked(mockRepo.findTransactionsNeedingPrices).mockResolvedValue(ok([tx1]) as any);

      vi.mocked(mockRepo.getTransactions).mockResolvedValue(ok([tx1]) as any);

      vi.mocked(mockRepo.updateMovementsWithPrices).mockResolvedValue(ok() as any);

      const result = await service.enrichPrices();

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().transactionsUpdated).toBe(1);

      // Verify BTC got exchange-execution price (even though it's blockchain)
      expect(mockRepo.updateMovementsWithPrices).toHaveBeenCalledWith(
        1,
        expect.arrayContaining([
          expect.objectContaining({
            asset: 'BTC',
            source: 'exchange-execution',
            granularity: 'exact',
          }),
        ])
      );
    });

    it('should skip crypto-crypto swaps on blockchain (no fiat/stable)', async () => {
      const mockRepo = createMockTransactionRepository();
      const mockLinkRepo = createMockLinkRepository();

      const service = new PriceEnrichmentService(mockRepo, mockLinkRepo);

      // Blockchain swap: 2 ETH for 100 SOL (no fiat/stablecoin)
      const tx1 = createMockTransaction(
        1,
        'blockchain',
        'ethereum',
        '2024-01-01T10:00:00Z',
        [
          {
            asset: 'SOL',
            amount: parseDecimal('100'),
          },
        ],
        [
          {
            asset: 'ETH',
            amount: parseDecimal('2'),
          },
        ]
      );

      vi.mocked(mockRepo.findTransactionsNeedingPrices).mockResolvedValue(ok([tx1]) as any);

      vi.mocked(mockRepo.getTransactions).mockResolvedValue(ok([tx1]) as any);

      vi.mocked(mockRepo.updateMovementsWithPrices).mockResolvedValue(ok() as any);

      const result = await service.enrichPrices();

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().transactionsUpdated).toBe(0); // Should be 0, not enriched

      // Verify updateMovementsWithPrices was NOT called
      expect(mockRepo.updateMovementsWithPrices).not.toHaveBeenCalled();
    });
  });

  describe('Stats and Reporting', () => {
    it('should only count transactions that actually got prices (not just attempted)', async () => {
      const mockRepo = createMockTransactionRepository();
      const mockLinkRepo = createMockLinkRepository();

      const service = new PriceEnrichmentService(mockRepo, mockLinkRepo);

      // Transaction 1: Can be enriched (fiat trade)
      const tx1 = createMockTransaction(
        1,
        'exchange',
        'kraken',
        '2024-01-01T10:00:00Z',
        [
          {
            asset: 'BTC',
            amount: parseDecimal('1'),
          },
        ],
        [
          {
            asset: 'USDT',
            amount: parseDecimal('50000'),
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
            amount: parseDecimal('100'),
          },
        ],
        [
          {
            asset: 'ADA',
            amount: parseDecimal('1000'),
          },
        ]
      );

      vi.mocked(mockRepo.findTransactionsNeedingPrices).mockResolvedValue(ok([tx1, tx2]) as any);

      vi.mocked(mockRepo.getTransactions).mockResolvedValue(ok([tx1, tx2]) as any);

      vi.mocked(mockRepo.updateMovementsWithPrices).mockResolvedValue(ok() as any);

      const result = await service.enrichPrices();

      expect(result.isOk()).toBe(true);
      // Should only count tx1, not tx2 (which has no prices)
      expect(result._unsafeUnwrap().transactionsUpdated).toBe(1);

      // Verify only tx1 was updated
      expect(mockRepo.updateMovementsWithPrices).toHaveBeenCalledTimes(1);
      expect(mockRepo.updateMovementsWithPrices).toHaveBeenCalledWith(1, expect.any(Array));
    });

    it('should return 0 when no transactions need prices', async () => {
      const mockRepo = createMockTransactionRepository();
      const mockLinkRepo = createMockLinkRepository();

      const service = new PriceEnrichmentService(mockRepo, mockLinkRepo);

      vi.mocked(mockRepo.findTransactionsNeedingPrices).mockResolvedValue(ok([]) as any);

      const result = await service.enrichPrices();

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().transactionsUpdated).toBe(0);

      // Should not call getTransactions or update
      expect(mockRepo.getTransactions).not.toHaveBeenCalled();
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
        ok([createMockTransaction(1, 'exchange', 'kraken', '2024-01-01T10:00:00Z', [], [])]) as any
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
            amount: parseDecimal('1'),
          },
        ],
        [
          {
            asset: 'USDT',
            amount: parseDecimal('50000'),
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
            amount: parseDecimal('20'),
          },
        ],
        [
          {
            asset: 'USDT',
            amount: parseDecimal('60000'),
          },
        ]
      );

      vi.mocked(mockRepo.findTransactionsNeedingPrices).mockResolvedValue(ok([tx1, tx2]) as any);

      vi.mocked(mockRepo.getTransactions).mockResolvedValue(ok([tx1, tx2]) as any);

      // First call (kraken) succeeds, second call (kucoin) fails
      vi.mocked(mockRepo.updateMovementsWithPrices)
        .mockResolvedValueOnce(ok() as any)
        .mockResolvedValueOnce(err(new Error('Update failed')));

      const result = await service.enrichPrices();

      // Should still return ok with partial results
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().transactionsUpdated).toBe(1); // Only kraken succeeded
    });
  });

  describe('Edge Cases', () => {
    it('should handle transactions with null movements', async () => {
      const mockRepo = createMockTransactionRepository();
      const mockLinkRepo = createMockLinkRepository();

      const service = new PriceEnrichmentService(mockRepo, mockLinkRepo);

      const tx1 = createMockTransaction(1, 'exchange', 'kraken', '2024-01-01T10:00:00Z', [], []);

      vi.mocked(mockRepo.findTransactionsNeedingPrices).mockResolvedValue(ok([tx1]) as any);

      vi.mocked(mockRepo.getTransactions).mockResolvedValue(ok([tx1]) as any);

      const result = await service.enrichPrices();

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().transactionsUpdated).toBe(0);
    });
  });
});
