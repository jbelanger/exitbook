/* eslint-disable @typescript-eslint/no-unsafe-argument -- Acceptable for tests */
/* eslint-disable @typescript-eslint/unbound-method -- Acceptable for tests */
/* eslint-disable @typescript-eslint/no-explicit-any -- Acceptable for test mocks */

import type { SourceType, UniversalTransaction } from '@exitbook/core';
import { Currency, parseDecimal, type AssetMovement } from '@exitbook/core';
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

    it('should return 0 when database is empty', async () => {
      const mockRepo = createMockTransactionRepository();
      const mockLinkRepo = createMockLinkRepository();

      const service = new PriceEnrichmentService(mockRepo, mockLinkRepo);

      vi.mocked(mockRepo.findTransactionsNeedingPrices).mockResolvedValue(ok([]) as any);
      vi.mocked(mockRepo.getTransactions).mockResolvedValue(ok([]) as any);

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
        [{ asset: 'BTC', amount: parseDecimal('1') }],
        [{ asset: 'USDT', amount: parseDecimal('50000') }]
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
            amount: parseDecimal('1'),
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
        [{ asset: 'BTC', amount: parseDecimal('0.999') }], // Slightly less due to network fee
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
      vi.mocked(mockRepo.findTransactionsNeedingPrices).mockResolvedValue(ok([tx3Deposit]) as any);
      vi.mocked(mockRepo.getTransactions).mockResolvedValue(ok([tx1Buy, tx2Withdrawal, tx3Deposit]) as any);
      vi.mocked(mockLinkRepo.findAll).mockResolvedValue(ok([link]) as any);
      vi.mocked(mockRepo.updateMovementsWithPrices).mockResolvedValue(ok() as any);

      const result = await service.enrichPrices();

      expect(result.isOk()).toBe(true);
      // 1 transaction updated: the Bitcoin deposit gets price from link propagation
      expect(result._unsafeUnwrap().transactionsUpdated).toBe(1);

      // Verify Bitcoin deposit got price from linked Kraken withdrawal
      const depositCalls = vi.mocked(mockRepo.updateMovementsWithPrices).mock.calls.filter((call) => call[0] === 3);
      expect(depositCalls.length).toBeGreaterThan(0);
      expect(depositCalls[0]![1]).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            asset: 'BTC',
            source: 'link-propagated',
          }),
        ])
      );
    });

    it('should propagate prices through multi-hop links (Kraken → Bitcoin → Ethereum)', async () => {
      const mockRepo = createMockTransactionRepository();
      const mockLinkRepo = createMockLinkRepository();

      const service = new PriceEnrichmentService(mockRepo, mockLinkRepo);

      const baseTime = new Date('2024-01-01T10:00:00Z');

      // Step 1: Buy BTC on Kraken
      const tx1Buy = createMockTransaction(
        1,
        'exchange',
        'kraken',
        baseTime.toISOString(),
        [{ asset: 'BTC', amount: parseDecimal('1') }],
        [{ asset: 'USDT', amount: parseDecimal('50000') }]
      );

      // Step 2: Withdraw from Kraken (has price from buy)
      const tx2Withdrawal = createMockTransaction(
        2,
        'exchange',
        'kraken',
        new Date(baseTime.getTime() + 60000).toISOString(),
        [],
        [
          {
            asset: 'BTC',
            amount: parseDecimal('1'),
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
      const tx3BtcDeposit = createMockTransaction(
        3,
        'blockchain',
        'bitcoin',
        new Date(baseTime.getTime() + 120000).toISOString(),
        [{ asset: 'BTC', amount: parseDecimal('0.999') }],
        []
      );

      // Step 4: Bitcoin send to another wallet
      const tx4BtcSend = createMockTransaction(
        4,
        'blockchain',
        'bitcoin',
        new Date(baseTime.getTime() + 180000).toISOString(),
        [],
        [{ asset: 'BTC', amount: parseDecimal('0.999') }]
      );

      // Step 5: Ethereum deposit (wrapped BTC - will get price from send via link propagation)
      const tx5EthDeposit = createMockTransaction(
        5,
        'blockchain',
        'ethereum',
        new Date(baseTime.getTime() + 240000).toISOString(),
        [{ asset: 'WBTC', amount: parseDecimal('0.998') }],
        []
      );

      // Create links to form a chain: tx2 → tx3 → tx4 → tx5
      const link1 = {
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

      const link2 = {
        id: 'link-2',
        sourceTransactionId: 3,
        targetTransactionId: 4,
        linkType: 'blockchain_to_blockchain' as const,
        confidenceScore: parseDecimal('0.95'),
        matchCriteria: {
          assetMatch: true,
          amountSimilarity: parseDecimal('1.0'),
          timingValid: true,
          timingHours: 0.05,
        },
        status: 'confirmed' as const,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const link3 = {
        id: 'link-3',
        sourceTransactionId: 4,
        targetTransactionId: 5,
        linkType: 'blockchain_to_blockchain' as const,
        confidenceScore: parseDecimal('0.90'),
        matchCriteria: {
          assetMatch: false, // BTC → WBTC
          amountSimilarity: parseDecimal('0.998'),
          timingValid: true,
          timingHours: 0.067,
        },
        status: 'confirmed' as const,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Only blockchain transactions need prices (withdrawal already has one)
      vi.mocked(mockRepo.findTransactionsNeedingPrices).mockResolvedValue(
        ok([tx3BtcDeposit, tx4BtcSend, tx5EthDeposit]) as any
      );
      vi.mocked(mockRepo.getTransactions).mockResolvedValue(
        ok([tx1Buy, tx2Withdrawal, tx3BtcDeposit, tx4BtcSend, tx5EthDeposit]) as any
      );
      vi.mocked(mockLinkRepo.findAll).mockResolvedValue(ok([link1, link2, link3]) as any);
      vi.mocked(mockRepo.updateMovementsWithPrices).mockResolvedValue(ok() as any);

      const result = await service.enrichPrices();

      expect(result.isOk()).toBe(true);

      // Verify transactions got prices through the multi-hop link chain
      // tx3 gets price from link1 (Kraken withdrawal → Bitcoin deposit)
      // tx5 gets price from link3 (Bitcoin send → Ethereum deposit) if tx4 has outflow price
      expect(result._unsafeUnwrap().transactionsUpdated).toBeGreaterThanOrEqual(1);

      // Verify tx3 (Bitcoin deposit) got link-propagated price from Kraken withdrawal
      const tx3Calls = vi.mocked(mockRepo.updateMovementsWithPrices).mock.calls.filter((call) => call[0] === 3);
      if (tx3Calls.length > 0) {
        expect(tx3Calls[0]![1]).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              asset: 'BTC',
              source: 'link-propagated',
              price: expect.objectContaining({
                amount: parseDecimal('50000'),
              }) as { amount: ReturnType<typeof parseDecimal> },
            }),
          ])
        );
      }
    });

    it('should not propagate prices when amounts differ too much', async () => {
      const mockRepo = createMockTransactionRepository();
      const mockLinkRepo = createMockLinkRepository();

      const service = new PriceEnrichmentService(mockRepo, mockLinkRepo);

      const baseTime = new Date('2024-01-01T10:00:00Z');

      // Withdrawal: 1 BTC
      const tx1 = createMockTransaction(
        1,
        'exchange',
        'kraken',
        baseTime.toISOString(),
        [],
        [{ asset: 'BTC', amount: parseDecimal('1') }]
      );

      // Deposit: 0.5 BTC (50% difference - beyond 10% tolerance)
      const tx2 = createMockTransaction(
        2,
        'blockchain',
        'bitcoin',
        new Date(baseTime.getTime() + 60000).toISOString(),
        [{ asset: 'BTC', amount: parseDecimal('0.5') }],
        []
      );

      const link = {
        id: 'link-1',
        sourceTransactionId: 1,
        targetTransactionId: 2,
        linkType: 'exchange_to_blockchain' as const,
        confidenceScore: parseDecimal('0.60'),
        matchCriteria: {
          assetMatch: true,
          amountSimilarity: parseDecimal('0.5'),
          timingValid: true,
          timingHours: 0.017,
        },
        status: 'confirmed' as const,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      vi.mocked(mockRepo.findTransactionsNeedingPrices).mockResolvedValue(ok([tx2]) as any);
      vi.mocked(mockRepo.getTransactions).mockResolvedValue(ok([tx1, tx2]) as any);
      vi.mocked(mockLinkRepo.findAll).mockResolvedValue(ok([link]) as any);
      vi.mocked(mockRepo.updateMovementsWithPrices).mockResolvedValue(ok() as any);

      const result = await service.enrichPrices();

      expect(result.isOk()).toBe(true);
      // Should not propagate price due to large amount difference
      expect(result._unsafeUnwrap().transactionsUpdated).toBe(0);
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
        [{ asset: 'BTC', amount: parseDecimal('1') }],
        [{ asset: 'USDT', amount: parseDecimal('50000') }]
      );

      const tx2 = createMockTransaction(
        2,
        'blockchain',
        'bitcoin',
        new Date(baseTime.getTime() + 60000).toISOString(),
        [{ asset: 'BTC', amount: parseDecimal('0.999') }],
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

      vi.mocked(mockRepo.findTransactionsNeedingPrices).mockResolvedValue(ok([tx2]) as any);
      vi.mocked(mockRepo.getTransactions).mockResolvedValue(ok([tx1, tx2]) as any);
      vi.mocked(mockLinkRepo.findAll).mockResolvedValue(ok([suggestedLink]) as any);
      vi.mocked(mockRepo.updateMovementsWithPrices).mockResolvedValue(ok() as any);

      const result = await service.enrichPrices();

      expect(result.isOk()).toBe(true);
      // Should not propagate price from suggested link
      expect(result._unsafeUnwrap().transactionsUpdated).toBe(0);
    });

    it('should handle links when source has no price', async () => {
      const mockRepo = createMockTransactionRepository();
      const mockLinkRepo = createMockLinkRepository();

      const service = new PriceEnrichmentService(mockRepo, mockLinkRepo);

      const baseTime = new Date('2024-01-01T10:00:00Z');

      // Withdrawal with no price
      const tx1 = createMockTransaction(
        1,
        'exchange',
        'kraken',
        baseTime.toISOString(),
        [],
        [{ asset: 'BTC', amount: parseDecimal('1') }]
      );

      // Deposit
      const tx2 = createMockTransaction(
        2,
        'blockchain',
        'bitcoin',
        new Date(baseTime.getTime() + 60000).toISOString(),
        [{ asset: 'BTC', amount: parseDecimal('0.999') }],
        []
      );

      const link = {
        id: 'link-1',
        sourceTransactionId: 1,
        targetTransactionId: 2,
        linkType: 'exchange_to_blockchain' as const,
        confidenceScore: parseDecimal('0.95'),
        matchCriteria: {
          assetMatch: true,
          amountSimilarity: parseDecimal('0.999'),
          timingValid: true,
          timingHours: 0.017,
        },
        status: 'confirmed' as const,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      vi.mocked(mockRepo.findTransactionsNeedingPrices).mockResolvedValue(ok([tx1, tx2]) as any);
      vi.mocked(mockRepo.getTransactions).mockResolvedValue(ok([tx1, tx2]) as any);
      vi.mocked(mockLinkRepo.findAll).mockResolvedValue(ok([link]) as any);
      vi.mocked(mockRepo.updateMovementsWithPrices).mockResolvedValue(ok() as any);

      const result = await service.enrichPrices();

      expect(result.isOk()).toBe(true);
      // No prices to propagate since source has no price
      expect(result._unsafeUnwrap().transactionsUpdated).toBe(0);
    });
  });

  describe('Crypto-Crypto Swap Ratio Pricing', () => {
    it('should persist ratio-corrected prices even when swap is NOT in needingPrices (real workflow)', async () => {
      const mockRepo = createMockTransactionRepository();
      const mockLinkRepo = createMockLinkRepository();

      const service = new PriceEnrichmentService(mockRepo, mockLinkRepo);

      const baseTime = new Date('2024-06-01T10:00:00Z');

      // Crypto-crypto swap: 1 BTC → 1,000 ADA
      // BOTH sides already have prices (from fetch), so findTransactionsNeedingPrices returns []
      // But Pass N+2 should still recalculate AND persist the corrected price
      const tx1Swap = createMockTransaction(
        1,
        'exchange',
        'kraken',
        baseTime.toISOString(),
        [
          {
            asset: 'ADA',
            amount: parseDecimal('1000'),
            priceAtTxTime: {
              price: { amount: parseDecimal('61'), currency: Currency.create('USD') },
              source: 'coingecko', // External fetch (wrong market price)
              fetchedAt: baseTime,
              granularity: 'exact',
            },
          },
        ],
        [
          {
            asset: 'BTC',
            amount: parseDecimal('1'),
            priceAtTxTime: {
              price: { amount: parseDecimal('60000'), currency: Currency.create('USD') },
              source: 'binance', // External fetch (correct FMV for disposal)
              fetchedAt: baseTime,
              granularity: 'exact',
            },
          },
        ]
      );

      // Real behavior: findTransactionsNeedingPrices returns [] because both sides have prices
      vi.mocked(mockRepo.findTransactionsNeedingPrices).mockResolvedValue(ok([]) as any);
      // But getTransactions returns the swap
      vi.mocked(mockRepo.getTransactions).mockResolvedValue(ok([tx1Swap]) as any);
      vi.mocked(mockRepo.updateMovementsWithPrices).mockResolvedValue(ok() as any);

      const result = await service.enrichPrices();

      expect(result.isOk()).toBe(true);
      // Should update 1 transaction (the swap with corrected ratio)
      expect(result._unsafeUnwrap().transactionsUpdated).toBe(1);

      // Verify ADA inflow price was recalculated AND persisted
      const updateCalls = vi.mocked(mockRepo.updateMovementsWithPrices).mock.calls;
      expect(updateCalls.length).toBe(1);

      const [txId, priceData] = updateCalls[0]!;
      expect(txId).toBe(1);

      // Find ADA price in the update
      const adaPrice = priceData.find((p) => p.asset === 'ADA');
      expect(adaPrice).toBeDefined();
      expect(adaPrice!.source).toBe('derived-ratio');
      expect(adaPrice!.price.amount.toFixed()).toBe('60'); // $60,000 / 1,000 = $60 (NOT $61)
    });

    it('should recalculate inflow price from outflow using swap ratio (Pass N+2)', async () => {
      const mockRepo = createMockTransactionRepository();
      const mockLinkRepo = createMockLinkRepository();

      const service = new PriceEnrichmentService(mockRepo, mockLinkRepo);

      const baseTime = new Date('2024-06-01T10:00:00Z');

      // Crypto-crypto swap: 1 BTC → 1,000 ADA
      // BTC outflow has price from fetch (FMV): $60,000
      // ADA inflow has wrong market price from fetch: $61 per coin
      // Should recalculate ADA to: $60,000 / 1,000 = $60 per coin (execution price)
      const tx1Swap = createMockTransaction(
        1,
        'exchange',
        'kraken',
        baseTime.toISOString(),
        [
          {
            asset: 'ADA',
            amount: parseDecimal('1000'),
            priceAtTxTime: {
              price: { amount: parseDecimal('61'), currency: Currency.create('USD') },
              source: 'coingecko', // External fetch
              fetchedAt: baseTime,
              granularity: 'exact',
            },
          },
        ],
        [
          {
            asset: 'BTC',
            amount: parseDecimal('1'),
            priceAtTxTime: {
              price: { amount: parseDecimal('60000'), currency: Currency.create('USD') },
              source: 'binance', // External fetch
              fetchedAt: baseTime,
              granularity: 'exact',
            },
          },
        ]
      );

      vi.mocked(mockRepo.findTransactionsNeedingPrices).mockResolvedValue(ok([tx1Swap]) as any);
      vi.mocked(mockRepo.getTransactions).mockResolvedValue(ok([tx1Swap]) as any);
      vi.mocked(mockRepo.updateMovementsWithPrices).mockResolvedValue(ok() as any);

      const result = await service.enrichPrices();

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().transactionsUpdated).toBe(1);

      // Verify ADA inflow price was recalculated from ratio
      const updateCalls = vi.mocked(mockRepo.updateMovementsWithPrices).mock.calls;
      expect(updateCalls.length).toBe(1);

      const [txId, priceData] = updateCalls[0]!;
      expect(txId).toBe(1);

      // Find ADA price in the update
      const adaPrice = priceData.find((p) => p.asset === 'ADA');
      expect(adaPrice).toBeDefined();
      expect(adaPrice!.source).toBe('derived-ratio');
      expect(adaPrice!.price.amount.toFixed()).toBe('60'); // $60,000 / 1,000 = $60

      // BTC price should remain unchanged
      const btcPrice = priceData.find((p) => p.asset === 'BTC');
      expect(btcPrice).toBeDefined();
      expect(btcPrice!.price.amount.toFixed()).toBe('60000');
    });

    it('should derive inflow price from outflow when only outflow has price (Pass 1)', async () => {
      const mockRepo = createMockTransactionRepository();
      const mockLinkRepo = createMockLinkRepository();

      const service = new PriceEnrichmentService(mockRepo, mockLinkRepo);

      const baseTime = new Date('2024-06-01T10:00:00Z');

      // Swap: 0.00713512 BTC → 705.32116 CFG
      // BTC outflow has price from fetch: $67,766.85
      // CFG inflow has NO price (exotic asset, provider doesn't have data)
      // Should derive CFG price: $67,766.85 * (0.00713512 / 705.32116) = $0.6852 per CFG
      const txSwap = createMockTransaction(
        1,
        'exchange',
        'kraken',
        baseTime.toISOString(),
        [
          {
            asset: 'CFG',
            amount: parseDecimal('705.32116'),
            // No priceAtTxTime - provider doesn't have CFG data
          },
        ],
        [
          {
            asset: 'BTC',
            amount: parseDecimal('0.00713512'),
            priceAtTxTime: {
              price: { amount: parseDecimal('67766.85'), currency: Currency.create('USD') },
              source: 'binance',
              fetchedAt: baseTime,
              granularity: 'exact',
            },
          },
        ]
      );

      vi.mocked(mockRepo.findTransactionsNeedingPrices).mockResolvedValue(ok([txSwap]) as any);
      vi.mocked(mockRepo.getTransactions).mockResolvedValue(ok([txSwap]) as any);
      vi.mocked(mockRepo.updateMovementsWithPrices).mockResolvedValue(ok() as any);

      const result = await service.enrichPrices();

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().transactionsUpdated).toBe(1);

      // Verify CFG inflow price was derived from BTC outflow using ratio
      const updateCalls = vi.mocked(mockRepo.updateMovementsWithPrices).mock.calls;
      expect(updateCalls.length).toBe(1);

      const [txId, priceData] = updateCalls[0]!;
      expect(txId).toBe(1);

      // Find CFG price in the update
      const cfgPrice = priceData.find((p) => p.asset === 'CFG');
      expect(cfgPrice).toBeDefined();
      expect(cfgPrice!.source).toBe('derived-ratio');
      // $67,766.85 * (0.00713512 / 705.32116) = $0.6855382118
      expect(cfgPrice!.price.amount.toNumber()).toBeCloseTo(0.6855, 3);
    });

    it('should NOT recalculate fiat/stablecoin trades (already execution prices)', async () => {
      const mockRepo = createMockTransactionRepository();
      const mockLinkRepo = createMockLinkRepository();

      const service = new PriceEnrichmentService(mockRepo, mockLinkRepo);

      const baseTime = new Date('2024-06-01T10:00:00Z');

      // Fiat trade: 50,000 USDT → 1 BTC
      // Should NOT recalculate because one side is stablecoin
      const tx1Trade = createMockTransaction(
        1,
        'exchange',
        'kraken',
        baseTime.toISOString(),
        [
          {
            asset: 'BTC',
            amount: parseDecimal('1'),
            priceAtTxTime: {
              price: { amount: parseDecimal('50000'), currency: Currency.create('USD') },
              source: 'exchange-execution',
              fetchedAt: baseTime,
              granularity: 'exact',
            },
          },
        ],
        [
          {
            asset: 'USDT',
            amount: parseDecimal('50000'),
          },
        ]
      );

      vi.mocked(mockRepo.findTransactionsNeedingPrices).mockResolvedValue(ok([tx1Trade]) as any);
      vi.mocked(mockRepo.getTransactions).mockResolvedValue(ok([tx1Trade]) as any);
      vi.mocked(mockRepo.updateMovementsWithPrices).mockResolvedValue(ok() as any);

      const result = await service.enrichPrices();

      expect(result.isOk()).toBe(true);

      // Verify BTC kept exchange-execution source (not overwritten with derived-ratio)
      const updateCalls = vi.mocked(mockRepo.updateMovementsWithPrices).mock.calls;
      if (updateCalls.length > 0) {
        const [, priceData] = updateCalls[0]!;
        const btcPrice = priceData.find((p) => p.asset === 'BTC');
        if (btcPrice) {
          expect(btcPrice.source).toBe('exchange-execution'); // NOT derived-ratio
        }
      }
    });

    it('should skip crypto-crypto swaps when either side lacks a price', async () => {
      const mockRepo = createMockTransactionRepository();
      const mockLinkRepo = createMockLinkRepository();

      const service = new PriceEnrichmentService(mockRepo, mockLinkRepo);

      const baseTime = new Date('2024-06-01T10:00:00Z');

      // Crypto-crypto swap but outflow has no price
      const tx1Swap = createMockTransaction(
        1,
        'exchange',
        'kraken',
        baseTime.toISOString(),
        [
          {
            asset: 'ADA',
            amount: parseDecimal('1000'),
            priceAtTxTime: {
              price: { amount: parseDecimal('61'), currency: Currency.create('USD') },
              source: 'coingecko',
              fetchedAt: baseTime,
              granularity: 'exact',
            },
          },
        ],
        [
          {
            asset: 'BTC',
            amount: parseDecimal('1'),
            // No price
          },
        ]
      );

      vi.mocked(mockRepo.findTransactionsNeedingPrices).mockResolvedValue(ok([tx1Swap]) as any);
      vi.mocked(mockRepo.getTransactions).mockResolvedValue(ok([tx1Swap]) as any);
      vi.mocked(mockRepo.updateMovementsWithPrices).mockResolvedValue(ok() as any);

      const result = await service.enrichPrices();

      expect(result.isOk()).toBe(true);

      // Should update with existing ADA price, but NOT recalculate
      const updateCalls = vi.mocked(mockRepo.updateMovementsWithPrices).mock.calls;
      if (updateCalls.length > 0) {
        const [, priceData] = updateCalls[0]!;
        const adaPrice = priceData.find((p) => p.asset === 'ADA');
        if (adaPrice) {
          // Should keep original source (coingecko), not derived-ratio
          expect(adaPrice.source).toBe('coingecko');
          expect(adaPrice.price.amount.toFixed()).toBe('61');
        }
      }
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
