/* eslint-disable unicorn/no-null -- null needed by db fixtures */
import {
  createTestDatabase,
  createTransactionLinkQueries,
  createTransactionQueries,
  type KyselyDB,
} from '@exitbook/data';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PriceDerivationService } from '../price-derivation-service.js';

async function setupPrerequisites(db: KyselyDB): Promise<void> {
  await db.insertInto('users').values({ id: 1, created_at: new Date().toISOString() }).execute();
  await db
    .insertInto('accounts')
    .values({
      id: 1,
      user_id: 1,
      account_type: 'exchange-api',
      source_name: 'kraken',
      identifier: 'test-api-key',
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

function createService(db: KyselyDB): PriceDerivationService {
  return new PriceDerivationService(createTransactionQueries(db), createTransactionLinkQueries(db));
}

const NULL_PRICE = {
  price_amount: null,
  price_currency: null,
  price_source: null,
  price_fetched_at: null,
  price_granularity: null,
  fx_rate_to_usd: null,
  fx_source: null,
  fx_timestamp: null,
} as const;

const NULL_FEE = {
  fee_amount: null,
  fee_scope: null,
  fee_settlement: null,
} as const;

describe('PriceEnrichmentService', () => {
  let db: KyselyDB;

  beforeEach(async () => {
    db = await createTestDatabase();
    await setupPrerequisites(db);
  });

  afterEach(async () => {
    await db.destroy();
  });

  describe('Stats and Reporting', () => {
    it('should return 0 when database is empty', async () => {
      const service = createService(db);
      const result = await service.derivePrices();

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().transactionsUpdated).toBe(0);
    });

    it('should only count transactions that actually got prices (not just attempted)', async () => {
      // tx1: BTC/USD trade — BTC price CAN be derived from USD outflow
      await db
        .insertInto('transactions')
        .values({
          id: 1,
          account_id: 1,
          source_name: 'kraken',
          source_type: 'exchange',
          external_id: 'tx-1',
          transaction_status: 'success',
          transaction_datetime: '2024-01-01T10:00:00.000Z',
          is_spam: false,
          excluded_from_accounting: false,
          operation_type: 'buy',
          created_at: new Date().toISOString(),
        })
        .execute();

      await db
        .insertInto('transaction_movements')
        .values([
          {
            transaction_id: 1,
            position: 0,
            movement_type: 'inflow',
            asset_id: 'exchange:kraken:btc',
            asset_symbol: 'BTC',
            gross_amount: '1',
            net_amount: '1',
            ...NULL_FEE,
            ...NULL_PRICE,
          },
          {
            transaction_id: 1,
            position: 1,
            movement_type: 'outflow',
            asset_id: 'fiat:usd',
            asset_symbol: 'USD',
            gross_amount: '50000',
            net_amount: '50000',
            ...NULL_FEE,
            ...NULL_PRICE,
          },
        ])
        .execute();

      // tx2: SOL/ADA crypto-crypto trade — no price can be derived
      await db
        .insertInto('transactions')
        .values({
          id: 2,
          account_id: 1,
          source_name: 'kraken',
          source_type: 'exchange',
          external_id: 'tx-2',
          transaction_status: 'success',
          transaction_datetime: '2024-01-01T11:00:00.000Z',
          is_spam: false,
          excluded_from_accounting: false,
          operation_type: 'swap',
          created_at: new Date().toISOString(),
        })
        .execute();

      await db
        .insertInto('transaction_movements')
        .values([
          {
            transaction_id: 2,
            position: 0,
            movement_type: 'inflow',
            asset_id: 'exchange:kraken:sol',
            asset_symbol: 'SOL',
            gross_amount: '100',
            net_amount: '100',
            ...NULL_FEE,
            ...NULL_PRICE,
          },
          {
            transaction_id: 2,
            position: 1,
            movement_type: 'outflow',
            asset_id: 'exchange:kraken:ada',
            asset_symbol: 'ADA',
            gross_amount: '1000',
            net_amount: '1000',
            ...NULL_FEE,
            ...NULL_PRICE,
          },
        ])
        .execute();

      const service = createService(db);
      const result = await service.derivePrices();

      expect(result.isOk()).toBe(true);
      // Only tx1 (BTC/USD) should have a derivable price
      expect(result._unsafeUnwrap().transactionsUpdated).toBe(1);
    });
  });

  describe('Price Propagation Across Links', () => {
    it('should propagate prices from exchange withdrawal to blockchain deposit', async () => {
      await db
        .insertInto('accounts')
        .values({
          id: 2,
          user_id: 1,
          account_type: 'blockchain',
          source_name: 'bitcoin',
          identifier: 'bc1q...',
          provider_name: null,
          parent_account_id: null,
          last_cursor: null,
          last_balance_check_at: null,
          verification_metadata: null,
          created_at: new Date().toISOString(),
          updated_at: null,
        })
        .execute();

      const baseTime = new Date('2024-01-01T10:00:00.000Z');
      const withdrawalTime = new Date(baseTime.getTime() + 60_000).toISOString();
      const depositTime = new Date(baseTime.getTime() + 120_000).toISOString();

      // tx2: BTC withdrawal from Kraken — already has a priced outflow (derived-trade)
      await db
        .insertInto('transactions')
        .values({
          id: 2,
          account_id: 1,
          source_name: 'kraken',
          source_type: 'exchange',
          external_id: 'tx-2',
          transaction_status: 'success',
          transaction_datetime: withdrawalTime,
          is_spam: false,
          excluded_from_accounting: false,
          operation_type: 'withdrawal',
          created_at: new Date().toISOString(),
        })
        .execute();

      await db
        .insertInto('transaction_movements')
        .values({
          transaction_id: 2,
          position: 0,
          movement_type: 'outflow',
          asset_id: 'exchange:kraken:btc',
          asset_symbol: 'BTC',
          gross_amount: '1',
          net_amount: '1',
          ...NULL_FEE,
          price_amount: '50000',
          price_currency: 'USD',
          price_source: 'derived-trade',
          price_fetched_at: baseTime.toISOString(),
          price_granularity: 'exact',
          fx_rate_to_usd: null,
          fx_source: null,
          fx_timestamp: null,
        })
        .execute();

      // tx3: BTC deposit on Bitcoin blockchain — no price yet
      await db
        .insertInto('transactions')
        .values({
          id: 3,
          account_id: 2,
          source_name: 'bitcoin',
          source_type: 'blockchain',
          external_id: 'tx-3',
          transaction_status: 'success',
          transaction_datetime: depositTime,
          is_spam: false,
          excluded_from_accounting: false,
          operation_type: 'deposit',
          blockchain_name: 'bitcoin',
          blockchain_transaction_hash: 'mock-hash-3',
          blockchain_is_confirmed: true,
          blockchain_block_height: 123_459,
          created_at: new Date().toISOString(),
        })
        .execute();

      await db
        .insertInto('transaction_movements')
        .values({
          transaction_id: 3,
          position: 0,
          movement_type: 'inflow',
          asset_id: 'blockchain:bitcoin:native',
          asset_symbol: 'BTC',
          gross_amount: '0.999',
          net_amount: '0.999',
          ...NULL_FEE,
          ...NULL_PRICE,
        })
        .execute();

      // Confirmed link: tx2 withdrawal → tx3 deposit
      await db
        .insertInto('transaction_links')
        .values({
          id: 1,
          source_transaction_id: 2,
          target_transaction_id: 3,
          asset: 'BTC',
          source_asset_id: 'exchange:kraken:btc',
          target_asset_id: 'blockchain:bitcoin:native',
          source_amount: '1',
          target_amount: '0.999',
          link_type: 'exchange_to_blockchain',
          confidence_score: '0.95',
          match_criteria_json: JSON.stringify({
            assetMatch: true,
            amountSimilarity: 0.999,
            timingValid: true,
            timingHours: 0.033,
          }),
          status: 'confirmed',
          reviewed_by: null,
          reviewed_at: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          metadata_json: null,
        })
        .execute();

      const service = createService(db);
      const result = await service.derivePrices();

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().transactionsUpdated).toBeGreaterThanOrEqual(1);

      // Verify deposit movement received link-propagated price
      const depositMovements = await db
        .selectFrom('transaction_movements')
        .selectAll()
        .where('transaction_id', '=', 3)
        .where('movement_type', '=', 'inflow')
        .execute();

      expect(depositMovements[0]?.price_source).toBe('link-propagated');
    });

    it('should not propagate prices from suggested (unconfirmed) links', async () => {
      const baseTime = new Date('2024-01-01T10:00:00.000Z');

      // tx1: BTC/USD trade — priced withdrawal
      await db
        .insertInto('transactions')
        .values({
          id: 1,
          account_id: 1,
          source_name: 'kraken',
          source_type: 'exchange',
          external_id: 'tx-1',
          transaction_status: 'success',
          transaction_datetime: baseTime.toISOString(),
          is_spam: false,
          excluded_from_accounting: false,
          operation_type: 'withdrawal',
          created_at: new Date().toISOString(),
        })
        .execute();

      await db
        .insertInto('transaction_movements')
        .values({
          transaction_id: 1,
          position: 0,
          movement_type: 'outflow',
          asset_id: 'exchange:kraken:btc',
          asset_symbol: 'BTC',
          gross_amount: '1',
          net_amount: '1',
          ...NULL_FEE,
          price_amount: '50000',
          price_currency: 'USD',
          price_source: 'derived-trade',
          price_fetched_at: baseTime.toISOString(),
          price_granularity: 'exact',
          fx_rate_to_usd: null,
          fx_source: null,
          fx_timestamp: null,
        })
        .execute();

      // tx2: BTC deposit — no price
      await db
        .insertInto('transactions')
        .values({
          id: 2,
          account_id: 1,
          source_name: 'kraken',
          source_type: 'exchange',
          external_id: 'tx-2',
          transaction_status: 'success',
          transaction_datetime: new Date(baseTime.getTime() + 60_000).toISOString(),
          is_spam: false,
          excluded_from_accounting: false,
          operation_type: 'deposit',
          created_at: new Date().toISOString(),
        })
        .execute();

      await db
        .insertInto('transaction_movements')
        .values({
          transaction_id: 2,
          position: 0,
          movement_type: 'inflow',
          asset_id: 'exchange:kraken:btc',
          asset_symbol: 'BTC',
          gross_amount: '0.999',
          net_amount: '0.999',
          ...NULL_FEE,
          ...NULL_PRICE,
        })
        .execute();

      // Suggested link only (should NOT trigger rederive)
      await db
        .insertInto('transaction_links')
        .values({
          id: 1,
          source_transaction_id: 1,
          target_transaction_id: 2,
          asset: 'BTC',
          source_asset_id: 'exchange:kraken:btc',
          target_asset_id: 'exchange:kraken:btc',
          source_amount: '1',
          target_amount: '0.999',
          link_type: 'exchange_to_exchange',
          confidence_score: '0.85',
          match_criteria_json: JSON.stringify({
            assetMatch: true,
            amountSimilarity: 0.999,
            timingValid: true,
            timingHours: 0.017,
          }),
          status: 'suggested',
          reviewed_by: null,
          reviewed_at: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          metadata_json: null,
        })
        .execute();

      const service = createService(db);
      await service.derivePrices();

      // tx2's inflow must remain unpriced (suggested link ignored)
      const tx2Movements = await db
        .selectFrom('transaction_movements')
        .selectAll()
        .where('transaction_id', '=', 2)
        .where('movement_type', '=', 'inflow')
        .execute();

      expect(tx2Movements[0]?.price_source).toBeNull();
    });
  });

  describe('Edge Cases', () => {
    it('should handle transactions with no movements', async () => {
      await db
        .insertInto('transactions')
        .values({
          id: 1,
          account_id: 1,
          source_name: 'kraken',
          source_type: 'exchange',
          external_id: 'tx-1',
          transaction_status: 'success',
          transaction_datetime: '2024-01-01T10:00:00.000Z',
          is_spam: false,
          excluded_from_accounting: false,
          operation_type: 'deposit',
          created_at: new Date().toISOString(),
        })
        .execute();

      const service = createService(db);
      const result = await service.derivePrices();

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().transactionsUpdated).toBe(0);
    });
  });
});
