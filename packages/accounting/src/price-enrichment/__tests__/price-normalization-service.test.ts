/* eslint-disable unicorn/no-null -- null needed by db fixtures */
/* eslint-disable @typescript-eslint/unbound-method -- acceptable for tests */
/**
 * Tests for PriceNormalizationService
 *
 * Integration tests using an in-memory database.
 * FX provider is mocked (it's a genuine external dependency).
 */

import { type Currency, parseDecimal } from '@exitbook/core';
import { createTestDatabase, createTransactionQueries, type KyselyDB } from '@exitbook/data';
import { err, ok } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PriceNormalizationService } from '../price-normalization-service.js';
import type { IFxRateProvider } from '../types.js';

function createMockFxProvider(): IFxRateProvider {
  return { getRateToUSD: vi.fn() } as unknown as IFxRateProvider;
}

async function setupPrerequisites(db: KyselyDB): Promise<void> {
  await db.insertInto('users').values({ id: 1, created_at: new Date().toISOString() }).execute();
  await db
    .insertInto('accounts')
    .values({
      id: 1,
      user_id: 1,
      account_type: 'exchange-api',
      source_name: 'test-exchange',
      identifier: 'test-key',
      provider_name: null,
      parent_account_id: null,
      last_cursor: null,
      last_balance_check_at: null,
      verification_metadata: null,
      created_at: new Date().toISOString(),
      updated_at: null,
    })
    .execute();
  await db
    .insertInto('import_sessions')
    .values({
      id: 1,
      account_id: 1,
      started_at: new Date().toISOString(),
      status: 'completed',
      transactions_imported: 0,
      transactions_skipped: 0,
      created_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    })
    .execute();
}

async function insertTransaction(db: KyselyDB, id: number, datetime: string): Promise<void> {
  await db
    .insertInto('transactions')
    .values({
      id,
      account_id: 1,
      source_name: 'test-exchange',
      source_type: 'exchange',
      external_id: `test-${id}`,
      transaction_status: 'success',
      transaction_datetime: datetime,
      is_spam: false,
      excluded_from_accounting: false,
      operation_type: 'buy',
      created_at: new Date().toISOString(),
    })
    .execute();
}

describe('PriceNormalizationService', () => {
  let db: KyselyDB;
  let mockFxProvider: IFxRateProvider;
  let service: PriceNormalizationService;

  beforeEach(async () => {
    db = await createTestDatabase();
    await setupPrerequisites(db);
    mockFxProvider = createMockFxProvider();
    service = new PriceNormalizationService(createTransactionQueries(db), mockFxProvider);
  });

  afterEach(async () => {
    await db.destroy();
  });

  describe('normalize()', () => {
    it('should successfully normalize EUR prices to USD', async () => {
      await insertTransaction(db, 1, '2023-01-15T10:00:00.000Z');
      await db
        .insertInto('transaction_movements')
        .values([
          {
            transaction_id: 1,
            position: 0,
            movement_type: 'inflow',
            asset_id: 'exchange:test:btc',
            asset_symbol: 'BTC',
            gross_amount: '1.0',
            net_amount: '1.0',
            fee_amount: null,
            fee_scope: null,
            fee_settlement: null,
            price_amount: '40000',
            price_currency: 'EUR',
            price_source: 'exchange-execution',
            price_fetched_at: '2023-01-15T10:00:00.000Z',
            price_granularity: 'exact',
            fx_rate_to_usd: null,
            fx_source: null,
            fx_timestamp: null,
          },
          {
            transaction_id: 1,
            position: 1,
            movement_type: 'outflow',
            asset_id: 'fiat:eur',
            asset_symbol: 'EUR',
            gross_amount: '40000',
            net_amount: '40000',
            fee_amount: null,
            fee_scope: null,
            fee_settlement: null,
            price_amount: null,
            price_currency: null,
            price_source: null,
            price_fetched_at: null,
            price_granularity: null,
            fx_rate_to_usd: null,
            fx_source: null,
            fx_timestamp: null,
          },
        ])
        .execute();

      vi.mocked(mockFxProvider.getRateToUSD).mockResolvedValue(
        ok({ rate: parseDecimal('1.08'), source: 'ecb', fetchedAt: new Date('2023-01-15T10:00:00Z') })
      );

      const result = await service.normalize();

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.movementsNormalized).toBe(1);
        expect(result.value.movementsSkipped).toBe(0);
        expect(result.value.failures).toBe(0);
        expect(result.value.errors).toHaveLength(0);
      }

      expect(mockFxProvider.getRateToUSD).toHaveBeenCalledWith('EUR' as Currency, new Date('2023-01-15T10:00:00Z'));
    });

    it('should skip USD prices (already normalized)', async () => {
      await insertTransaction(db, 1, '2023-01-15T10:00:00.000Z');
      await db
        .insertInto('transaction_movements')
        .values({
          transaction_id: 1,
          position: 0,
          movement_type: 'inflow',
          asset_id: 'exchange:test:btc',
          asset_symbol: 'BTC',
          gross_amount: '1.0',
          net_amount: '1.0',
          fee_amount: null,
          fee_scope: null,
          fee_settlement: null,
          price_amount: '50000',
          price_currency: 'USD',
          price_source: 'exchange-execution',
          price_fetched_at: '2023-01-15T10:00:00.000Z',
          price_granularity: 'exact',
          fx_rate_to_usd: null,
          fx_source: null,
          fx_timestamp: null,
        })
        .execute();

      const result = await service.normalize();

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.movementsNormalized).toBe(0);
        expect(result.value.movementsSkipped).toBe(1);
        expect(result.value.failures).toBe(0);
      }
      expect(mockFxProvider.getRateToUSD).not.toHaveBeenCalled();
    });

    it('should skip crypto prices (BTC priced in ETH)', async () => {
      await insertTransaction(db, 1, '2023-01-15T10:00:00.000Z');
      await db
        .insertInto('transaction_movements')
        .values({
          transaction_id: 1,
          position: 0,
          movement_type: 'inflow',
          asset_id: 'exchange:test:btc',
          asset_symbol: 'BTC',
          gross_amount: '1.0',
          net_amount: '1.0',
          fee_amount: null,
          fee_scope: null,
          fee_settlement: null,
          price_amount: '15',
          price_currency: 'ETH',
          price_source: 'exchange-execution',
          price_fetched_at: '2023-01-15T10:00:00.000Z',
          price_granularity: 'exact',
          fx_rate_to_usd: null,
          fx_source: null,
          fx_timestamp: null,
        })
        .execute();

      const result = await service.normalize();

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.movementsNormalized).toBe(0);
        expect(result.value.movementsSkipped).toBe(1); // Crypto prices counted as skipped
        expect(result.value.failures).toBe(0);
      }
      expect(mockFxProvider.getRateToUSD).not.toHaveBeenCalled();
    });

    it('should handle FX rate fetch failures gracefully', async () => {
      await insertTransaction(db, 1, '2023-01-15T10:00:00.000Z');
      await db
        .insertInto('transaction_movements')
        .values({
          transaction_id: 1,
          position: 0,
          movement_type: 'inflow',
          asset_id: 'exchange:test:btc',
          asset_symbol: 'BTC',
          gross_amount: '1.0',
          net_amount: '1.0',
          fee_amount: null,
          fee_scope: null,
          fee_settlement: null,
          price_amount: '40000',
          price_currency: 'EUR',
          price_source: 'exchange-execution',
          price_fetched_at: '2023-01-15T10:00:00.000Z',
          price_granularity: 'exact',
          fx_rate_to_usd: null,
          fx_source: null,
          fx_timestamp: null,
        })
        .execute();

      vi.mocked(mockFxProvider.getRateToUSD).mockResolvedValue(err(new Error('Provider unavailable')));

      const result = await service.normalize();

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.movementsNormalized).toBe(0);
        expect(result.value.failures).toBe(1);
        expect(result.value.errors).toHaveLength(1);
        expect(result.value.errors[0]).toContain('Provider unavailable');
      }
    });

    it('should normalize multiple currencies in a single transaction', async () => {
      await insertTransaction(db, 1, '2023-01-15T10:00:00.000Z');
      await db
        .insertInto('transaction_movements')
        .values([
          {
            transaction_id: 1,
            position: 0,
            movement_type: 'inflow',
            asset_id: 'exchange:test:btc',
            asset_symbol: 'BTC',
            gross_amount: '1.0',
            net_amount: '1.0',
            fee_amount: null,
            fee_scope: null,
            fee_settlement: null,
            price_amount: '40000',
            price_currency: 'EUR',
            price_source: 'exchange-execution',
            price_fetched_at: '2023-01-15T10:00:00.000Z',
            price_granularity: 'exact',
            fx_rate_to_usd: null,
            fx_source: null,
            fx_timestamp: null,
          },
          {
            transaction_id: 1,
            position: 1,
            movement_type: 'inflow',
            asset_id: 'exchange:test:eth',
            asset_symbol: 'ETH',
            gross_amount: '10.0',
            net_amount: '10.0',
            fee_amount: null,
            fee_scope: null,
            fee_settlement: null,
            price_amount: '2500',
            price_currency: 'CAD',
            price_source: 'exchange-execution',
            price_fetched_at: '2023-01-15T10:00:00.000Z',
            price_granularity: 'exact',
            fx_rate_to_usd: null,
            fx_source: null,
            fx_timestamp: null,
          },
        ])
        .execute();

      vi.mocked(mockFxProvider.getRateToUSD)
        .mockResolvedValueOnce(
          ok({ rate: parseDecimal('1.08'), source: 'ecb', fetchedAt: new Date('2023-01-15T10:00:00Z') })
        )
        .mockResolvedValueOnce(
          ok({ rate: parseDecimal('0.74'), source: 'bank-of-canada', fetchedAt: new Date('2023-01-15T10:00:00Z') })
        );

      const result = await service.normalize();

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.movementsNormalized).toBe(2);
        expect(result.value.failures).toBe(0);
      }

      expect(mockFxProvider.getRateToUSD).toHaveBeenCalledTimes(2);
      expect(mockFxProvider.getRateToUSD).toHaveBeenCalledWith('EUR' as Currency, new Date('2023-01-15T10:00:00Z'));
      expect(mockFxProvider.getRateToUSD).toHaveBeenCalledWith('CAD' as Currency, new Date('2023-01-15T10:00:00Z'));
    });

    it('should normalize platform fees with non-USD fiat prices', async () => {
      await insertTransaction(db, 1, '2023-01-15T10:00:00.000Z');
      await db
        .insertInto('transaction_movements')
        .values([
          {
            transaction_id: 1,
            position: 0,
            movement_type: 'inflow',
            asset_id: 'exchange:test:btc',
            asset_symbol: 'BTC',
            gross_amount: '1.0',
            net_amount: '1.0',
            fee_amount: null,
            fee_scope: null,
            fee_settlement: null,
            price_amount: null,
            price_currency: null,
            price_source: null,
            price_fetched_at: null,
            price_granularity: null,
            fx_rate_to_usd: null,
            fx_source: null,
            fx_timestamp: null,
          },
          {
            transaction_id: 1,
            position: 1,
            movement_type: 'outflow',
            asset_id: 'fiat:usd',
            asset_symbol: 'USD',
            gross_amount: '50000',
            net_amount: '50000',
            fee_amount: null,
            fee_scope: null,
            fee_settlement: null,
            price_amount: null,
            price_currency: null,
            price_source: null,
            price_fetched_at: null,
            price_granularity: null,
            fx_rate_to_usd: null,
            fx_source: null,
            fx_timestamp: null,
          },
          // Platform fee priced in EUR
          {
            transaction_id: 1,
            position: 2,
            movement_type: 'fee',
            asset_id: 'fiat:eur',
            asset_symbol: 'EUR',
            gross_amount: null,
            net_amount: null,
            fee_amount: '100',
            fee_scope: 'platform',
            fee_settlement: 'balance',
            price_amount: '100',
            price_currency: 'EUR',
            price_source: 'exchange-execution',
            price_fetched_at: '2023-01-15T10:00:00.000Z',
            price_granularity: 'exact',
            fx_rate_to_usd: null,
            fx_source: null,
            fx_timestamp: null,
          },
        ])
        .execute();

      vi.mocked(mockFxProvider.getRateToUSD).mockResolvedValue(
        ok({ rate: parseDecimal('1.08'), source: 'ecb', fetchedAt: new Date('2023-01-15T10:00:00Z') })
      );

      const result = await service.normalize();

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.movementsNormalized).toBe(1); // Only the fee is normalized
        expect(result.value.failures).toBe(0);
      }
    });

    it('should normalize network fees with non-USD fiat prices', async () => {
      await insertTransaction(db, 1, '2023-01-15T10:00:00.000Z');
      await db
        .insertInto('transaction_movements')
        .values([
          {
            transaction_id: 1,
            position: 0,
            movement_type: 'inflow',
            asset_id: 'exchange:test:btc',
            asset_symbol: 'BTC',
            gross_amount: '1.0',
            net_amount: '1.0',
            fee_amount: null,
            fee_scope: null,
            fee_settlement: null,
            price_amount: null,
            price_currency: null,
            price_source: null,
            price_fetched_at: null,
            price_granularity: null,
            fx_rate_to_usd: null,
            fx_source: null,
            fx_timestamp: null,
          },
          {
            transaction_id: 1,
            position: 1,
            movement_type: 'outflow',
            asset_id: 'fiat:usd',
            asset_symbol: 'USD',
            gross_amount: '50000',
            net_amount: '50000',
            fee_amount: null,
            fee_scope: null,
            fee_settlement: null,
            price_amount: null,
            price_currency: null,
            price_source: null,
            price_fetched_at: null,
            price_granularity: null,
            fx_rate_to_usd: null,
            fx_source: null,
            fx_timestamp: null,
          },
          // Network fee priced in GBP
          {
            transaction_id: 1,
            position: 2,
            movement_type: 'fee',
            asset_id: 'fiat:gbp',
            asset_symbol: 'GBP',
            gross_amount: null,
            net_amount: null,
            fee_amount: '50',
            fee_scope: 'network',
            fee_settlement: 'on-chain',
            price_amount: '50',
            price_currency: 'GBP',
            price_source: 'exchange-execution',
            price_fetched_at: '2023-01-15T10:00:00.000Z',
            price_granularity: 'exact',
            fx_rate_to_usd: null,
            fx_source: null,
            fx_timestamp: null,
          },
        ])
        .execute();

      vi.mocked(mockFxProvider.getRateToUSD).mockResolvedValue(
        ok({ rate: parseDecimal('1.27'), source: 'ecb', fetchedAt: new Date('2023-01-15T10:00:00Z') })
      );

      const result = await service.normalize();

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.movementsNormalized).toBe(1); // Network fee normalized
        expect(result.value.failures).toBe(0);
      }
    });

    it('should skip movements without prices', async () => {
      await insertTransaction(db, 1, '2023-01-15T10:00:00.000Z');
      await db
        .insertInto('transaction_movements')
        .values({
          transaction_id: 1,
          position: 0,
          movement_type: 'inflow',
          asset_id: 'blockchain:bitcoin:native',
          asset_symbol: 'BTC',
          gross_amount: '1.0',
          net_amount: '1.0',
          fee_amount: null,
          fee_scope: null,
          fee_settlement: null,
          price_amount: null,
          price_currency: null,
          price_source: null,
          price_fetched_at: null,
          price_granularity: null,
          fx_rate_to_usd: null,
          fx_source: null,
          fx_timestamp: null,
        })
        .execute();

      const result = await service.normalize();

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.movementsNormalized).toBe(0);
        expect(result.value.movementsSkipped).toBe(0);
        expect(result.value.failures).toBe(0);
      }
      expect(mockFxProvider.getRateToUSD).not.toHaveBeenCalled();
    });

    it('should process multiple transactions correctly', async () => {
      await insertTransaction(db, 1, '2023-01-15T10:00:00.000Z');
      await insertTransaction(db, 2, '2023-01-16T10:00:00.000Z');

      await db
        .insertInto('transaction_movements')
        .values([
          // tx1: BTC with EUR price — needs normalization
          {
            transaction_id: 1,
            position: 0,
            movement_type: 'inflow',
            asset_id: 'exchange:test:btc',
            asset_symbol: 'BTC',
            gross_amount: '1.0',
            net_amount: '1.0',
            fee_amount: null,
            fee_scope: null,
            fee_settlement: null,
            price_amount: '40000',
            price_currency: 'EUR',
            price_source: 'exchange-execution',
            price_fetched_at: '2023-01-15T10:00:00.000Z',
            price_granularity: 'exact',
            fx_rate_to_usd: null,
            fx_source: null,
            fx_timestamp: null,
          },
          // tx2: ETH with USD price — already normalized, skip
          {
            transaction_id: 2,
            position: 0,
            movement_type: 'inflow',
            asset_id: 'exchange:test:eth',
            asset_symbol: 'ETH',
            gross_amount: '10.0',
            net_amount: '10.0',
            fee_amount: null,
            fee_scope: null,
            fee_settlement: null,
            price_amount: '50000',
            price_currency: 'USD',
            price_source: 'exchange-execution',
            price_fetched_at: '2023-01-16T10:00:00.000Z',
            price_granularity: 'exact',
            fx_rate_to_usd: null,
            fx_source: null,
            fx_timestamp: null,
          },
        ])
        .execute();

      vi.mocked(mockFxProvider.getRateToUSD).mockResolvedValue(
        ok({ rate: parseDecimal('1.08'), source: 'ecb', fetchedAt: new Date('2023-01-15T10:00:00Z') })
      );

      const result = await service.normalize();

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.movementsNormalized).toBe(1); // Only tx1 EUR normalized
        expect(result.value.movementsSkipped).toBe(1); // tx2 USD skipped
        expect(result.value.failures).toBe(0);
      }
    });
  });
});
