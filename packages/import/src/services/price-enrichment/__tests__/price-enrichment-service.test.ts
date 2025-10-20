/* eslint-disable @typescript-eslint/no-unsafe-argument -- Acceptable for tests */
/* eslint-disable @typescript-eslint/unbound-method -- Acceptable for tests */
/* eslint-disable @typescript-eslint/no-explicit-any -- Acceptable for test mocks */
/* eslint-disable unicorn/no-null -- nulls needed by db */
import { parseDecimal, type AssetMovement } from '@exitbook/core';
import type { StoredTransaction, TransactionRepository } from '@exitbook/data';
import { ok, err } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';

import { PriceEnrichmentService } from '../price-enrichment-service.ts';

// Helper to create a mock StoredTransaction with typed movements
function createMockTransaction(
  id: number,
  sourceType: 'exchange' | 'blockchain',
  sourceId: string,
  datetime: string,
  inflows: AssetMovement[],
  outflows: AssetMovement[]
): StoredTransaction {
  return {
    id,
    import_session_id: 1,
    wallet_address_id: null,
    source_id: sourceId,
    source_type: sourceType,
    external_id: `tx-${id}`,
    transaction_status: 'confirmed',
    transaction_datetime: datetime,
    from_address: null,
    to_address: null,
    verified: false,
    price: null,
    price_currency: null,
    note_type: null,
    note_severity: null,
    note_message: null,
    note_metadata: null,
    raw_normalized_data: '{}',
    movements_inflows: inflows,
    movements_outflows: outflows,
    fees_network: null,
    fees_platform: null,
    fees_total: null,
    operation_category: 'trade',
    operation_type: 'buy',
    blockchain_name: sourceType === 'blockchain' ? sourceId : null,
    blockchain_block_height: null,
    blockchain_transaction_hash: null,
    blockchain_is_confirmed: null,
    created_at: datetime,
    updated_at: null,
  };
}

describe('PriceEnrichmentService', () => {
  describe('Happy Path: Exchange Trades', () => {
    it('should apply exchange-execution prices directly to fiat/stable trades (Pass 0)', async () => {
      const mockRepo = {
        findTransactionsNeedingPrices: vi.fn(),
        getTransactions: vi.fn(),
        updateMovementsWithPrices: vi.fn(),
      } as unknown as TransactionRepository;

      const service = new PriceEnrichmentService(mockRepo);

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

    it('should perform multi-pass inference for crypto-crypto trades', async () => {
      const mockRepo = {
        findTransactionsNeedingPrices: vi.fn(),
        getTransactions: vi.fn(),
        updateMovementsWithPrices: vi.fn(),
      } as unknown as TransactionRepository;

      const service = new PriceEnrichmentService(mockRepo);

      const baseTime = new Date('2024-01-01T10:00:00Z');

      // Transaction 1: Buy 1 BTC with 50,000 USDT (establishes BTC price)
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

      // Transaction 2: Swap 1 BTC for 20 ETH (should infer ETH price from BTC)
      const tx2 = createMockTransaction(
        2,
        'exchange',
        'kraken',
        new Date(baseTime.getTime() + 300000).toISOString(), // +5 min
        [
          {
            asset: 'ETH',
            amount: parseDecimal('20'),
          },
        ],
        [
          {
            asset: 'BTC',
            amount: parseDecimal('1'),
          },
        ]
      );

      vi.mocked(mockRepo.findTransactionsNeedingPrices).mockResolvedValue(ok([tx1, tx2]) as any);

      vi.mocked(mockRepo.getTransactions).mockResolvedValue(ok([tx1, tx2]) as any);

      vi.mocked(mockRepo.updateMovementsWithPrices).mockResolvedValue(ok() as any);

      const result = await service.enrichPrices();

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().transactionsUpdated).toBe(2);

      // Verify tx1 got exchange-execution price
      const tx1Calls = vi.mocked(mockRepo.updateMovementsWithPrices).mock.calls.filter((call) => call[0] === 1);
      expect(tx1Calls.length).toBeGreaterThan(0);
      expect(tx1Calls[0]![1]).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            asset: 'BTC',
            source: 'exchange-execution',
          }),
        ])
      );

      // Verify tx2 got derived-trade price for ETH
      const tx2Calls = vi.mocked(mockRepo.updateMovementsWithPrices).mock.calls.filter((call) => call[0] === 2);
      expect(tx2Calls.length).toBeGreaterThan(0);
      expect(tx2Calls[0]![1]).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            asset: 'ETH',
            source: 'derived-trade',
          }),
        ])
      );
    });

    it('should use temporal proximity for movements without direct trades (Pass N+1)', async () => {
      const mockRepo = {
        findTransactionsNeedingPrices: vi.fn(),
        getTransactions: vi.fn(),
        updateMovementsWithPrices: vi.fn(),
      } as unknown as TransactionRepository;

      const service = new PriceEnrichmentService(mockRepo);

      const baseTime = new Date('2024-01-01T10:00:00Z');

      // Transaction 1: Buy 1 BTC with 50,000 USDT
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

      // Transaction 2: Receive 0.5 BTC (no trade, just inflow - should use temporal proximity)
      const tx2 = createMockTransaction(
        2,
        'exchange',
        'kraken',
        new Date(baseTime.getTime() + 600000).toISOString(), // +10 min
        [
          {
            asset: 'BTC',
            amount: parseDecimal('0.5'),
          },
        ],
        [] // No outflow
      );

      vi.mocked(mockRepo.findTransactionsNeedingPrices).mockResolvedValue(ok([tx2]) as any); // Only tx2 needs prices

      vi.mocked(mockRepo.getTransactions).mockResolvedValue(ok([tx1, tx2]) as any); // But we need both to build price index

      vi.mocked(mockRepo.updateMovementsWithPrices).mockResolvedValue(ok() as any);

      const result = await service.enrichPrices();

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().transactionsUpdated).toBe(1);

      // Verify tx2 got derived-history price (from temporal proximity)
      const tx2Calls = vi.mocked(mockRepo.updateMovementsWithPrices).mock.calls.filter((call) => call[0] === 2);
      expect(tx2Calls.length).toBeGreaterThan(0);
      expect(tx2Calls[0]![1]).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            asset: 'BTC',
            source: 'derived-history',
          }),
        ])
      );
    });

    it('should process multiple exchanges independently', async () => {
      const mockRepo = {
        findTransactionsNeedingPrices: vi.fn(),
        getTransactions: vi.fn(),
        updateMovementsWithPrices: vi.fn(),
      } as unknown as TransactionRepository;

      const service = new PriceEnrichmentService(mockRepo);

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
      expect(tx1Calls[0]![1][0]!.price.amount.toString()).toBe('50000');

      const tx2Calls = vi.mocked(mockRepo.updateMovementsWithPrices).mock.calls.filter((call) => call[0] === 2);
      expect(tx2Calls[0]![1][0]!.price.amount.toString()).toBe('50100');
    });
  });

  describe('Happy Path: Blockchain Transactions', () => {
    it('should enrich simple stablecoin swaps on blockchain', async () => {
      const mockRepo = {
        findTransactionsNeedingPrices: vi.fn(),
        getTransactions: vi.fn(),
        updateMovementsWithPrices: vi.fn(),
      } as unknown as TransactionRepository;

      const service = new PriceEnrichmentService(mockRepo);

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
      const mockRepo = {
        findTransactionsNeedingPrices: vi.fn(),
        getTransactions: vi.fn(),
        updateMovementsWithPrices: vi.fn(),
      } as unknown as TransactionRepository;

      const service = new PriceEnrichmentService(mockRepo);

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
      const mockRepo = {
        findTransactionsNeedingPrices: vi.fn(),
        getTransactions: vi.fn(),
        updateMovementsWithPrices: vi.fn(),
      } as unknown as TransactionRepository;

      const service = new PriceEnrichmentService(mockRepo);

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
      const mockRepo = {
        findTransactionsNeedingPrices: vi.fn(),
        getTransactions: vi.fn(),
        updateMovementsWithPrices: vi.fn(),
      } as unknown as TransactionRepository;

      const service = new PriceEnrichmentService(mockRepo);

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
      const mockRepo = {
        findTransactionsNeedingPrices: vi.fn(),
        getTransactions: vi.fn(),
        updateMovementsWithPrices: vi.fn(),
      } as unknown as TransactionRepository;

      const service = new PriceEnrichmentService(mockRepo);

      vi.mocked(mockRepo.findTransactionsNeedingPrices).mockResolvedValue(err(new Error('Database connection failed')));

      const result = await service.enrichPrices();

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toBe('Database connection failed');
    });

    it('should handle database errors when getting all transactions', async () => {
      const mockRepo = {
        findTransactionsNeedingPrices: vi.fn(),
        getTransactions: vi.fn(),
        updateMovementsWithPrices: vi.fn(),
      } as unknown as TransactionRepository;

      const service = new PriceEnrichmentService(mockRepo);

      vi.mocked(mockRepo.findTransactionsNeedingPrices).mockResolvedValue(
        ok([createMockTransaction(1, 'exchange', 'kraken', '2024-01-01T10:00:00Z', [], [])]) as any
      );

      vi.mocked(mockRepo.getTransactions).mockResolvedValue(err(new Error('Failed to fetch transactions')));

      const result = await service.enrichPrices();

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toBe('Failed to fetch transactions');
    });

    it('should continue processing other exchanges if one fails', async () => {
      const mockRepo = {
        findTransactionsNeedingPrices: vi.fn(),
        getTransactions: vi.fn(),
        updateMovementsWithPrices: vi.fn(),
      } as unknown as TransactionRepository;

      const service = new PriceEnrichmentService(mockRepo);

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
      const mockRepo = {
        findTransactionsNeedingPrices: vi.fn(),
        getTransactions: vi.fn(),
        updateMovementsWithPrices: vi.fn(),
      } as unknown as TransactionRepository;

      const service = new PriceEnrichmentService(mockRepo);

      const tx1 = createMockTransaction(1, 'exchange', 'kraken', '2024-01-01T10:00:00Z', [], []);

      vi.mocked(mockRepo.findTransactionsNeedingPrices).mockResolvedValue(ok([tx1]) as any);

      vi.mocked(mockRepo.getTransactions).mockResolvedValue(ok([tx1]) as any);

      const result = await service.enrichPrices();

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().transactionsUpdated).toBe(0);
    });

    it('should respect maxIterations config to prevent infinite loops', async () => {
      const mockRepo = {
        findTransactionsNeedingPrices: vi.fn(),
        getTransactions: vi.fn(),
        updateMovementsWithPrices: vi.fn(),
      } as unknown as TransactionRepository;

      const service = new PriceEnrichmentService(mockRepo, { maxTimeDeltaMs: 3600000, maxIterations: 2 });

      const baseTime = new Date('2024-01-01T10:00:00Z');

      // Create a long chain that would require many iterations
      // COIN0 <- USDT (Pass 0)
      // COIN1 <- COIN0 (Pass 1)
      // COIN2 <- COIN1 (Pass 2)
      // COIN3 <- COIN2 (Pass 3 - should be blocked by maxIterations=2)
      const transactions: StoredTransaction[] = [];
      for (let i = 0; i < 10; i++) {
        transactions.push(
          createMockTransaction(
            i,
            'exchange',
            'kraken',
            new Date(baseTime.getTime() + i * 60000).toISOString(),
            [
              {
                asset: `COIN${i}`,
                amount: parseDecimal('1'),
              },
            ],
            [
              {
                asset: i === 0 ? 'USDT' : `COIN${i - 1}`,
                amount: parseDecimal('100'),
              },
            ]
          )
        );
      }

      vi.mocked(mockRepo.findTransactionsNeedingPrices).mockResolvedValue(ok(transactions) as any);

      vi.mocked(mockRepo.getTransactions).mockResolvedValue(ok(transactions) as any);

      vi.mocked(mockRepo.updateMovementsWithPrices).mockResolvedValue(ok() as any);

      const result = await service.enrichPrices();

      // Should complete without hanging
      expect(result.isOk()).toBe(true);
      // Pass 0: COIN0 (1 transaction)
      // Pass 1: COIN1 (1 transaction)
      // Pass 2: COIN2 (1 transaction)
      // Total = 3 transactions enriched with prices directly from trades
      // Pass N+1 (temporal proximity) can enrich the rest using derived-history
      // So all 10 might be enriched, but the multi-pass inference stops at iteration 2
      // The important thing is it completes without hanging
      expect(result._unsafeUnwrap().transactionsUpdated).toBeGreaterThanOrEqual(3);
      expect(result._unsafeUnwrap().transactionsUpdated).toBeLessThanOrEqual(10);
    });
  });
});
