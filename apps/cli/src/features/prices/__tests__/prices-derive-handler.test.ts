import type { KyselyDB } from '@exitbook/data';
import { err, ok } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { PricesDeriveHandler } from '../prices-derive-handler.ts';

// Mock dependencies
vi.mock('@exitbook/data', async () => {
  const actual = await vi.importActual<typeof import('@exitbook/data')>('@exitbook/data');
  return {
    ...actual,
    TransactionRepository: vi.fn(),
  };
});

vi.mock('@exitbook/import', async () => {
  const actual = await vi.importActual<typeof import('@exitbook/import')>('@exitbook/import');
  return {
    ...actual,
    PriceEnrichmentService: vi.fn(),
  };
});

describe('PricesDeriveHandler', () => {
  let handler: PricesDeriveHandler;
  let mockDb: KyselyDB;
  let mockTransactionRepo: {
    getTransactions: Mock;
  };
  let mockPriceService: {
    enrichPrices: Mock;
  };

  beforeEach(async () => {
    // Reset mocks
    vi.clearAllMocks();

    // Create mock database
    mockDb = {} as KyselyDB;

    // Create mock transaction repository
    mockTransactionRepo = {
      getTransactions: vi.fn(),
    };

    // Create mock price enrichment service
    mockPriceService = {
      enrichPrices: vi.fn(),
    };

    // Setup mocks
    const { TransactionRepository } = await import('@exitbook/data');
    (TransactionRepository as unknown as Mock).mockImplementation(() => mockTransactionRepo);

    const { PriceEnrichmentService } = await import('@exitbook/import');
    (PriceEnrichmentService as unknown as Mock).mockImplementation(() => mockPriceService);

    // Create handler
    handler = new PricesDeriveHandler(mockDb);
  });

  afterEach(() => {
    handler.destroy();
  });

  describe('execute', () => {
    it('should call PriceEnrichmentService and return movement stats', async () => {
      // Setup mocks - before enrichment: 100 movements without prices
      const txsBefore = [
        {
          movements_inflows: JSON.stringify([
            { asset: 'BTC', amount: 1 }, // No price
            { asset: 'ETH', amount: 2 }, // No price
          ]),
          movements_outflows: JSON.stringify([
            { asset: 'USD', amount: 50000, priceAtTxTime: {} }, // Has price
          ]),
        },
        {
          movements_inflows: JSON.stringify([
            { asset: 'SOL', amount: 10 }, // No price
          ]),
          movements_outflows: undefined,
        },
      ];

      // After enrichment: 1 movement still without price (SOL)
      const txsAfter = [
        {
          movements_inflows: JSON.stringify([
            { asset: 'BTC', amount: 1, priceAtTxTime: {} }, // Now has price
            { asset: 'ETH', amount: 2, priceAtTxTime: {} }, // Now has price
          ]),
          movements_outflows: JSON.stringify([
            { asset: 'USD', amount: 50000, priceAtTxTime: {} }, // Still has price
          ]),
        },
        {
          movements_inflows: JSON.stringify([
            { asset: 'SOL', amount: 10 }, // Still no price
          ]),
          movements_outflows: undefined,
        },
      ];

      // First call (before) returns txsBefore, second call (after) returns txsAfter
      mockTransactionRepo.getTransactions.mockResolvedValueOnce(ok(txsBefore)).mockResolvedValueOnce(ok(txsAfter));

      mockPriceService.enrichPrices.mockResolvedValue(ok({ transactionsUpdated: 1 }));

      // Execute
      const result = await handler.execute();

      // Verify
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.totalMovements).toBe(4); // BTC, ETH, USD, SOL
        expect(result.value.movementsEnriched).toBe(2); // BTC and ETH got prices
        expect(result.value.movementsStillNeedingPrices).toBe(1); // SOL still needs price
      }

      // Verify service was called
      expect(mockPriceService.enrichPrices).toHaveBeenCalledTimes(1);
      expect(mockTransactionRepo.getTransactions).toHaveBeenCalledTimes(2);
    });

    it('should handle zero movements enriched', async () => {
      // Setup mocks - no prices could be derived
      const txs = [
        {
          movements_inflows: JSON.stringify([{ asset: 'BTC', amount: 1 }]),
          movements_outflows: undefined,
        },
      ];

      // Same before and after (no changes)
      mockTransactionRepo.getTransactions.mockResolvedValueOnce(ok(txs)).mockResolvedValueOnce(ok(txs));

      mockPriceService.enrichPrices.mockResolvedValue(ok({ transactionsUpdated: 0 }));

      // Execute
      const result = await handler.execute();

      // Verify
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.totalMovements).toBe(1);
        expect(result.value.movementsEnriched).toBe(0);
        expect(result.value.movementsStillNeedingPrices).toBe(1);
      }
    });

    it('should handle all movements having prices after derivation', async () => {
      // Setup mocks - before: movements without prices
      const txsBefore = [
        {
          movements_inflows: JSON.stringify([{ asset: 'BTC', amount: 1 }]),
          movements_outflows: JSON.stringify([{ asset: 'USD', amount: 50000 }]),
        },
      ];

      // After: all movements have prices
      const txsAfter = [
        {
          movements_inflows: JSON.stringify([{ asset: 'BTC', amount: 1, priceAtTxTime: {} }]),
          movements_outflows: JSON.stringify([{ asset: 'USD', amount: 50000, priceAtTxTime: {} }]),
        },
      ];

      mockTransactionRepo.getTransactions.mockResolvedValueOnce(ok(txsBefore)).mockResolvedValueOnce(ok(txsAfter));

      mockPriceService.enrichPrices.mockResolvedValue(ok({ transactionsUpdated: 1 }));

      // Execute
      const result = await handler.execute();

      // Verify
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.totalMovements).toBe(2);
        expect(result.value.movementsEnriched).toBe(2);
        expect(result.value.movementsStillNeedingPrices).toBe(0);
      }
    });

    it('should handle errors from PriceEnrichmentService', async () => {
      // Setup mocks - before query succeeds
      mockTransactionRepo.getTransactions.mockResolvedValueOnce(ok([]));

      // But service returns error
      const serviceError = new Error('Database connection failed');
      mockPriceService.enrichPrices.mockResolvedValue(err(serviceError));

      // Execute
      const result = await handler.execute();

      // Verify
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error).toBe(serviceError);
      }

      // Verify getTransactions was called once (before enrichment) but not after
      expect(mockTransactionRepo.getTransactions).toHaveBeenCalledTimes(1);
    });

    it('should handle errors from TransactionRepository on initial query', async () => {
      // Setup mocks - initial query fails
      const repoError = new Error('Failed to query database');
      mockTransactionRepo.getTransactions.mockResolvedValue(err(repoError));

      // Execute
      const result = await handler.execute();

      // Verify
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error).toBe(repoError);
      }

      // Verify enrichment was never called
      expect(mockPriceService.enrichPrices).not.toHaveBeenCalled();
    });

    it('should handle errors from TransactionRepository on after-enrichment query', async () => {
      // Setup mocks - before query succeeds
      mockTransactionRepo.getTransactions.mockResolvedValueOnce(ok([]));

      // Enrichment succeeds
      mockPriceService.enrichPrices.mockResolvedValue(ok({ transactionsUpdated: 0 }));

      // But after query fails
      const repoError = new Error('Failed to query database after enrichment');
      mockTransactionRepo.getTransactions.mockResolvedValueOnce(err(repoError));

      // Execute
      const result = await handler.execute();

      // Verify
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error).toBe(repoError);
      }
    });

    it('should handle unexpected exceptions', async () => {
      // Setup mocks - before query throws
      mockTransactionRepo.getTransactions.mockRejectedValue(new Error('Unexpected error'));

      // Execute
      const result = await handler.execute();

      // Verify
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toBe('Unexpected error');
      }
    });
  });

  describe('destroy', () => {
    it('should cleanup resources without error', () => {
      expect(() => handler.destroy()).not.toThrow();
    });

    it('should be safe to call multiple times', () => {
      handler.destroy();
      expect(() => handler.destroy()).not.toThrow();
    });
  });
});
