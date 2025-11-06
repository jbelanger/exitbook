/* eslint-disable @typescript-eslint/unbound-method -- acceptable for tests */
/**
 * Tests for PriceNormalizationService
 *
 * Tests the imperative shell that orchestrates FX normalization
 * Uses mocked dependencies for repositories and FX provider
 */

import { Currency, parseDecimal } from '@exitbook/core';
import type { FeeMovement, PriceAtTxTime, UniversalTransaction } from '@exitbook/core';
import type { TransactionRepository } from '@exitbook/data';
import { Decimal } from 'decimal.js';
import { err, ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { IFxRateProvider } from '../fx-rate-provider.interface.js';
import { PriceNormalizationService } from '../price-normalization-service.js';

function createFeeMovement(
  scope: 'network' | 'platform' | 'spread' | 'tax' | 'other',
  settlement: 'on-chain' | 'balance' | 'external',
  asset: string,
  amount: string,
  priceAtTxTime?: PriceAtTxTime
): FeeMovement {
  const movement: FeeMovement = {
    scope,
    settlement,
    asset,
    amount: new Decimal(amount),
  };

  if (priceAtTxTime !== undefined) {
    movement.priceAtTxTime = priceAtTxTime;
  }

  return movement;
}

describe('PriceNormalizationService', () => {
  let mockTransactionRepo: TransactionRepository;
  let mockFxProvider: IFxRateProvider;
  let service: PriceNormalizationService;

  beforeEach(() => {
    // Mock transaction repository
    mockTransactionRepo = {
      getTransactions: vi.fn(),
      updateMovementsWithPrices: vi.fn(),
    } as unknown as TransactionRepository;

    // Mock FX rate provider
    mockFxProvider = {
      getRateToUSD: vi.fn(),
    } as unknown as IFxRateProvider;

    service = new PriceNormalizationService(mockTransactionRepo, mockFxProvider);
  });

  describe('normalize()', () => {
    it('should successfully normalize EUR prices to USD', async () => {
      // Arrange
      const transaction: UniversalTransaction = {
        id: 1,
        externalId: 'test-1',
        datetime: '2023-01-15T10:00:00Z',
        timestamp: Date.parse('2023-01-15T10:00:00Z'),
        source: 'test-exchange',
        status: 'success',
        movements: {
          inflows: [
            {
              asset: 'BTC',
              grossAmount: parseDecimal('1.0'),
              priceAtTxTime: {
                price: { amount: parseDecimal('40000'), currency: Currency.create('EUR') },
                source: 'exchange-execution',
                fetchedAt: new Date('2023-01-15T10:00:00Z'),
                granularity: 'exact',
              },
            },
          ],
          outflows: [{ asset: 'EUR', grossAmount: parseDecimal('40000') }],
        },
        fees: [],
        operation: { category: 'trade', type: 'buy' },
      };

      vi.mocked(mockTransactionRepo.getTransactions).mockResolvedValue(ok([transaction]));
      vi.mocked(mockFxProvider.getRateToUSD).mockResolvedValue(
        ok({
          rate: new Decimal('1.08'),
          source: 'ecb',
          fetchedAt: new Date('2023-01-15T10:00:00Z'),
        })
      );
      vi.mocked(mockTransactionRepo.updateMovementsWithPrices).mockResolvedValue(ok());

      // Act
      const result = await service.normalize();

      // Assert
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.movementsNormalized).toBe(1);
        expect(result.value.movementsSkipped).toBe(0);
        expect(result.value.failures).toBe(0);
        expect(result.value.errors).toHaveLength(0);
      }

      // Verify FX provider was called correctly
      expect(mockFxProvider.getRateToUSD).toHaveBeenCalledWith(
        Currency.create('EUR'),
        new Date('2023-01-15T10:00:00Z')
      );

      // Verify transaction was updated
      expect(mockTransactionRepo.updateMovementsWithPrices).toHaveBeenCalledTimes(1);
    });

    it('should skip USD prices (already normalized)', async () => {
      // Arrange
      const transaction: UniversalTransaction = {
        id: 1,
        externalId: 'test-1',
        datetime: '2023-01-15T10:00:00Z',
        timestamp: Date.parse('2023-01-15T10:00:00Z'),
        source: 'test-exchange',
        status: 'success',
        movements: {
          inflows: [
            {
              asset: 'BTC',
              grossAmount: parseDecimal('1.0'),
              priceAtTxTime: {
                price: { amount: parseDecimal('50000'), currency: Currency.create('USD') },
                source: 'exchange-execution',
                fetchedAt: new Date('2023-01-15T10:00:00Z'),
                granularity: 'exact',
              },
            },
          ],
          outflows: [{ asset: 'USD', grossAmount: parseDecimal('50000') }],
        },
        fees: [],
        operation: { category: 'trade', type: 'buy' },
      };

      vi.mocked(mockTransactionRepo.getTransactions).mockResolvedValue(ok([transaction]));

      // Act
      const result = await service.normalize();

      // Assert
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.movementsNormalized).toBe(0);
        expect(result.value.movementsSkipped).toBe(1);
        expect(result.value.failures).toBe(0);
      }

      // FX provider should not be called for USD prices
      expect(mockFxProvider.getRateToUSD).not.toHaveBeenCalled();

      // No updates needed for USD-only transaction
      expect(mockTransactionRepo.updateMovementsWithPrices).not.toHaveBeenCalled();
    });

    it('should skip crypto prices (BTC priced in ETH)', async () => {
      // Arrange
      const transaction: UniversalTransaction = {
        id: 1,
        externalId: 'test-1',
        datetime: '2023-01-15T10:00:00Z',
        timestamp: Date.parse('2023-01-15T10:00:00Z'),
        source: 'test-exchange',
        status: 'success',
        movements: {
          inflows: [
            {
              asset: 'BTC',
              grossAmount: parseDecimal('1.0'),
              priceAtTxTime: {
                price: { amount: parseDecimal('15'), currency: Currency.create('ETH') },
                source: 'exchange-execution',
                fetchedAt: new Date('2023-01-15T10:00:00Z'),
                granularity: 'exact',
              },
            },
          ],
          outflows: [{ asset: 'ETH', grossAmount: parseDecimal('15') }],
        },
        fees: [],
        operation: { category: 'trade', type: 'swap' },
      };

      vi.mocked(mockTransactionRepo.getTransactions).mockResolvedValue(ok([transaction]));

      // Act
      const result = await service.normalize();

      // Assert
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.movementsNormalized).toBe(0);
        expect(result.value.movementsSkipped).toBe(1); // Crypto prices are counted as skipped
        expect(result.value.failures).toBe(0);
      }

      // No FX lookup needed for crypto-to-crypto
      expect(mockFxProvider.getRateToUSD).not.toHaveBeenCalled();
    });

    it('should handle FX rate fetch failures gracefully', async () => {
      // Arrange
      const transaction: UniversalTransaction = {
        id: 1,
        externalId: 'test-1',
        datetime: '2023-01-15T10:00:00Z',
        timestamp: Date.parse('2023-01-15T10:00:00Z'),
        source: 'test-exchange',
        status: 'success',
        movements: {
          inflows: [
            {
              asset: 'BTC',
              grossAmount: parseDecimal('1.0'),
              priceAtTxTime: {
                price: { amount: parseDecimal('40000'), currency: Currency.create('EUR') },
                source: 'exchange-execution',
                fetchedAt: new Date('2023-01-15T10:00:00Z'),
                granularity: 'exact',
              },
            },
          ],
          outflows: [{ asset: 'EUR', grossAmount: parseDecimal('40000') }],
        },
        fees: [],
        operation: { category: 'trade', type: 'buy' },
      };

      vi.mocked(mockTransactionRepo.getTransactions).mockResolvedValue(ok([transaction]));
      vi.mocked(mockFxProvider.getRateToUSD).mockResolvedValue(err(new Error('Provider unavailable')));
      vi.mocked(mockTransactionRepo.updateMovementsWithPrices).mockResolvedValue(ok());

      // Act
      const result = await service.normalize();

      // Assert
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.movementsNormalized).toBe(0);
        expect(result.value.failures).toBe(1);
        expect(result.value.errors).toHaveLength(1);
        expect(result.value.errors[0]).toContain('Provider unavailable');
      }

      // Transaction still updates even if some movements fail (keeps original price)
      expect(mockTransactionRepo.updateMovementsWithPrices).toHaveBeenCalledTimes(1);
    });

    it('should normalize multiple currencies in single transaction', async () => {
      // Arrange
      const transaction: UniversalTransaction = {
        id: 1,
        externalId: 'test-1',
        datetime: '2023-01-15T10:00:00Z',
        timestamp: Date.parse('2023-01-15T10:00:00Z'),
        source: 'test-exchange',
        status: 'success',
        movements: {
          inflows: [
            {
              asset: 'BTC',
              grossAmount: parseDecimal('1.0'),
              priceAtTxTime: {
                price: { amount: parseDecimal('40000'), currency: Currency.create('EUR') },
                source: 'exchange-execution',
                fetchedAt: new Date('2023-01-15T10:00:00Z'),
                granularity: 'exact',
              },
            },
            {
              asset: 'ETH',
              grossAmount: parseDecimal('10.0'),
              priceAtTxTime: {
                price: { amount: parseDecimal('2500'), currency: Currency.create('CAD') },
                source: 'exchange-execution',
                fetchedAt: new Date('2023-01-15T10:00:00Z'),
                granularity: 'exact',
              },
            },
          ],
          outflows: [],
        },
        fees: [],
        operation: { category: 'trade', type: 'buy' },
      };

      vi.mocked(mockTransactionRepo.getTransactions).mockResolvedValue(ok([transaction]));
      vi.mocked(mockFxProvider.getRateToUSD)
        .mockResolvedValueOnce(
          ok({
            rate: new Decimal('1.08'),
            source: 'ecb',
            fetchedAt: new Date('2023-01-15T10:00:00Z'),
          })
        )
        .mockResolvedValueOnce(
          ok({
            rate: new Decimal('0.74'),
            source: 'bank-of-canada',
            fetchedAt: new Date('2023-01-15T10:00:00Z'),
          })
        );
      vi.mocked(mockTransactionRepo.updateMovementsWithPrices).mockResolvedValue(ok());

      // Act
      const result = await service.normalize();

      // Assert
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.movementsNormalized).toBe(2);
        expect(result.value.failures).toBe(0);
      }

      // Verify FX provider called for both currencies
      expect(mockFxProvider.getRateToUSD).toHaveBeenCalledTimes(2);
      expect(mockFxProvider.getRateToUSD).toHaveBeenCalledWith(
        Currency.create('EUR'),
        new Date('2023-01-15T10:00:00Z')
      );
      expect(mockFxProvider.getRateToUSD).toHaveBeenCalledWith(
        Currency.create('CAD'),
        new Date('2023-01-15T10:00:00Z')
      );
    });

    it('should normalize platform fees with non-USD fiat prices', async () => {
      // Arrange
      const transaction: UniversalTransaction = {
        id: 1,
        externalId: 'test-1',
        datetime: '2023-01-15T10:00:00Z',
        timestamp: Date.parse('2023-01-15T10:00:00Z'),
        source: 'test-exchange',
        status: 'success',
        movements: {
          inflows: [{ asset: 'BTC', grossAmount: parseDecimal('1.0') }],
          outflows: [{ asset: 'USD', grossAmount: parseDecimal('50000') }],
        },
        fees: [
          createFeeMovement('platform', 'balance', 'EUR', '100', {
            price: { amount: parseDecimal('100'), currency: Currency.create('EUR') },
            source: 'exchange-execution',
            fetchedAt: new Date('2023-01-15T10:00:00Z'),
            granularity: 'exact',
          }),
        ],
        operation: { category: 'trade', type: 'buy' },
      };

      vi.mocked(mockTransactionRepo.getTransactions).mockResolvedValue(ok([transaction]));
      vi.mocked(mockFxProvider.getRateToUSD).mockResolvedValue(
        ok({
          rate: new Decimal('1.08'),
          source: 'ecb',
          fetchedAt: new Date('2023-01-15T10:00:00Z'),
        })
      );
      vi.mocked(mockTransactionRepo.updateMovementsWithPrices).mockResolvedValue(ok());

      // Act
      const result = await service.normalize();

      // Assert
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.movementsNormalized).toBe(1); // Fee normalized
        expect(result.value.failures).toBe(0);
      }
    });

    it('should normalize network fees with non-USD fiat prices', async () => {
      // Arrange
      const transaction: UniversalTransaction = {
        id: 1,
        externalId: 'test-1',
        datetime: '2023-01-15T10:00:00Z',
        timestamp: Date.parse('2023-01-15T10:00:00Z'),
        source: 'test-exchange',
        status: 'success',
        movements: {
          inflows: [{ asset: 'BTC', grossAmount: parseDecimal('1.0') }],
          outflows: [{ asset: 'USD', grossAmount: parseDecimal('50000') }],
        },
        fees: [
          createFeeMovement('platform', 'balance', 'GBP', '50', {
            price: { amount: parseDecimal('50'), currency: Currency.create('GBP') },
            source: 'exchange-execution',
            fetchedAt: new Date('2023-01-15T10:00:00Z'),
            granularity: 'exact',
          }),
        ],
        operation: { category: 'trade', type: 'buy' },
      };

      vi.mocked(mockTransactionRepo.getTransactions).mockResolvedValue(ok([transaction]));
      vi.mocked(mockFxProvider.getRateToUSD).mockResolvedValue(
        ok({
          rate: new Decimal('1.27'),
          source: 'ecb',
          fetchedAt: new Date('2023-01-15T10:00:00Z'),
        })
      );
      vi.mocked(mockTransactionRepo.updateMovementsWithPrices).mockResolvedValue(ok());

      // Act
      const result = await service.normalize();

      // Assert
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.movementsNormalized).toBe(1); // Network fee normalized
        expect(result.value.failures).toBe(0);
      }
    });

    it('should skip movements without prices', async () => {
      // Arrange
      const transaction: UniversalTransaction = {
        id: 1,
        externalId: 'test-1',
        datetime: '2023-01-15T10:00:00Z',
        timestamp: Date.parse('2023-01-15T10:00:00Z'),
        source: 'blockchain',
        status: 'success',
        movements: {
          inflows: [
            {
              asset: 'BTC',
              grossAmount: parseDecimal('1.0'),
              // No priceAtTxTime
            },
          ],
          outflows: [],
        },
        fees: [],
        operation: { category: 'transfer', type: 'transfer' },
      };

      vi.mocked(mockTransactionRepo.getTransactions).mockResolvedValue(ok([transaction]));

      // Act
      const result = await service.normalize();

      // Assert
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.movementsNormalized).toBe(0);
        expect(result.value.movementsSkipped).toBe(0);
        expect(result.value.failures).toBe(0);
      }

      // No FX lookups for movements without prices
      expect(mockFxProvider.getRateToUSD).not.toHaveBeenCalled();
    });

    it('should handle database fetch errors', async () => {
      // Arrange
      vi.mocked(mockTransactionRepo.getTransactions).mockResolvedValue(err(new Error('Database connection failed')));

      // Act
      const result = await service.normalize();

      // Assert
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Database connection failed');
      }
    });

    it('should handle database update errors', async () => {
      // Arrange
      const transaction: UniversalTransaction = {
        id: 1,
        externalId: 'test-1',
        datetime: '2023-01-15T10:00:00Z',
        timestamp: Date.parse('2023-01-15T10:00:00Z'),
        source: 'test-exchange',
        status: 'success',
        movements: {
          inflows: [
            {
              asset: 'BTC',
              grossAmount: parseDecimal('1.0'),
              priceAtTxTime: {
                price: { amount: parseDecimal('40000'), currency: Currency.create('EUR') },
                source: 'exchange-execution',
                fetchedAt: new Date('2023-01-15T10:00:00Z'),
                granularity: 'exact',
              },
            },
          ],
          outflows: [],
        },
        fees: [],
        operation: { category: 'trade', type: 'buy' },
      };

      vi.mocked(mockTransactionRepo.getTransactions).mockResolvedValue(ok([transaction]));
      vi.mocked(mockFxProvider.getRateToUSD).mockResolvedValue(
        ok({
          rate: new Decimal('1.08'),
          source: 'ecb',
          fetchedAt: new Date('2023-01-15T10:00:00Z'),
        })
      );
      vi.mocked(mockTransactionRepo.updateMovementsWithPrices).mockResolvedValue(
        err(new Error('Update failed: constraint violation'))
      );

      // Act
      const result = await service.normalize();

      // Assert
      expect(result.isOk()).toBe(true); // Service continues despite update errors
      if (result.isOk()) {
        expect(result.value.movementsNormalized).toBe(1);
        expect(result.value.failures).toBe(1);
        expect(result.value.errors).toHaveLength(1);
        expect(result.value.errors[0]).toContain('constraint violation');
      }
    });

    it('should process multiple transactions correctly', async () => {
      // Arrange
      const tx1: UniversalTransaction = {
        id: 1,
        externalId: 'test-1',
        datetime: '2023-01-15T10:00:00Z',
        timestamp: Date.parse('2023-01-15T10:00:00Z'),
        source: 'test-exchange',
        status: 'success',
        movements: {
          inflows: [
            {
              asset: 'BTC',
              grossAmount: parseDecimal('1.0'),
              priceAtTxTime: {
                price: { amount: parseDecimal('40000'), currency: Currency.create('EUR') },
                source: 'exchange-execution',
                fetchedAt: new Date('2023-01-15T10:00:00Z'),
                granularity: 'exact',
              },
            },
          ],
          outflows: [],
        },
        fees: [],
        operation: { category: 'trade', type: 'buy' },
      };

      const tx2: UniversalTransaction = {
        id: 2,
        externalId: 'test-2',
        datetime: '2023-01-16T10:00:00Z',
        timestamp: Date.parse('2023-01-16T10:00:00Z'),
        source: 'test-exchange',
        status: 'success',
        movements: {
          inflows: [
            {
              asset: 'ETH',
              grossAmount: parseDecimal('10.0'),
              priceAtTxTime: {
                price: { amount: parseDecimal('50000'), currency: Currency.create('USD') },
                source: 'exchange-execution',
                fetchedAt: new Date('2023-01-16T10:00:00Z'),
                granularity: 'exact',
              },
            },
          ],
          outflows: [],
        },
        fees: [],
        operation: { category: 'trade', type: 'buy' },
      };

      vi.mocked(mockTransactionRepo.getTransactions).mockResolvedValue(ok([tx1, tx2]));
      vi.mocked(mockFxProvider.getRateToUSD).mockResolvedValue(
        ok({
          rate: new Decimal('1.08'),
          source: 'ecb',
          fetchedAt: new Date('2023-01-15T10:00:00Z'),
        })
      );
      vi.mocked(mockTransactionRepo.updateMovementsWithPrices).mockResolvedValue(ok());

      // Act
      const result = await service.normalize();

      // Assert
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.movementsNormalized).toBe(1); // Only tx1 needs normalization
        expect(result.value.movementsSkipped).toBe(1); // tx2 already USD
        expect(result.value.failures).toBe(0);
      }

      // Only one transaction updated (tx1)
      expect(mockTransactionRepo.updateMovementsWithPrices).toHaveBeenCalledTimes(1);
    });
  });
});
