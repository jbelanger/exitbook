import type { Currency } from '@exitbook/core';
import { DataContext } from '@exitbook/data';
import { createTestDataContext } from '@exitbook/data/test-utils';
import { Decimal } from 'decimal.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PriceDerivationService } from '../price-derivation-service.js';

async function setupPrerequisites(db: DataContext): Promise<{ accountId: number; userId: number }> {
  const userResult = await db.users.create();
  if (userResult.isErr()) throw userResult.error;
  const userId = userResult.value;

  const accountResult = await db.accounts.findOrCreate({
    userId,
    accountType: 'exchange-api',
    sourceName: 'kraken',
    identifier: 'test-api-key',
  });
  if (accountResult.isErr()) throw accountResult.error;
  const accountId = accountResult.value.id;

  const sessionResult = await db.importSessions.create(accountId);
  if (sessionResult.isErr()) throw sessionResult.error;

  return { userId, accountId };
}

function createService(db: DataContext): PriceDerivationService {
  return new PriceDerivationService(db);
}

describe('PriceEnrichmentService', () => {
  let db: DataContext;

  beforeEach(async () => {
    db = await createTestDataContext();
  });

  afterEach(async () => {
    await db.close();
  });

  describe('Stats and Reporting', () => {
    it('should return 0 when database is empty', async () => {
      await setupPrerequisites(db);
      const service = createService(db);
      const result = await service.derivePrices();

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().transactionsUpdated).toBe(0);
    });

    it('should only count transactions that actually got prices (not just attempted)', async () => {
      const { accountId } = await setupPrerequisites(db);

      // tx1: BTC/USD trade — BTC price CAN be derived from USD outflow
      const tx1Result = await db.transactions.save(
        {
          externalId: 'tx-1',
          datetime: '2024-01-01T10:00:00.000Z',
          timestamp: new Date('2024-01-01T10:00:00.000Z').getTime(),
          source: 'kraken',
          sourceType: 'exchange',
          status: 'success',
          operation: { category: 'trade', type: 'buy' },
          movements: {
            inflows: [
              { assetId: 'exchange:kraken:btc', assetSymbol: 'BTC' as Currency, grossAmount: new Decimal('1') },
            ],
            outflows: [{ assetId: 'fiat:usd', assetSymbol: 'USD' as Currency, grossAmount: new Decimal('50000') }],
          },
          fees: [],
        },
        accountId
      );
      if (tx1Result.isErr()) throw tx1Result.error;

      // tx2: SOL/ADA crypto-crypto trade — no price can be derived
      const tx2Result = await db.transactions.save(
        {
          externalId: 'tx-2',
          datetime: '2024-01-01T11:00:00.000Z',
          timestamp: new Date('2024-01-01T11:00:00.000Z').getTime(),
          source: 'kraken',
          sourceType: 'exchange',
          status: 'success',
          operation: { category: 'trade', type: 'swap' },
          movements: {
            inflows: [
              { assetId: 'exchange:kraken:sol', assetSymbol: 'SOL' as Currency, grossAmount: new Decimal('100') },
            ],
            outflows: [
              { assetId: 'exchange:kraken:ada', assetSymbol: 'ADA' as Currency, grossAmount: new Decimal('1000') },
            ],
          },
          fees: [],
        },
        accountId
      );
      if (tx2Result.isErr()) throw tx2Result.error;

      const service = createService(db);
      const result = await service.derivePrices();

      expect(result.isOk()).toBe(true);
      // Only tx1 (BTC/USD) should have a derivable price
      expect(result._unsafeUnwrap().transactionsUpdated).toBe(1);
    });
  });

  describe('Price Propagation Across Links', () => {
    it('should propagate prices from exchange withdrawal to blockchain deposit', async () => {
      const { userId, accountId: krakenAccountId } = await setupPrerequisites(db);

      const btcAccountResult = await db.accounts.findOrCreate({
        userId,
        accountType: 'blockchain',
        sourceName: 'bitcoin',
        identifier: 'bc1q...',
      });
      if (btcAccountResult.isErr()) throw btcAccountResult.error;
      const btcAccountId = btcAccountResult.value.id;

      const baseTime = new Date('2024-01-01T10:00:00.000Z');
      const withdrawalTime = new Date(baseTime.getTime() + 60_000).toISOString();
      const depositTime = new Date(baseTime.getTime() + 120_000).toISOString();

      // BTC withdrawal from Kraken — already has a priced outflow (derived-trade)
      const withdrawalResult = await db.transactions.save(
        {
          externalId: 'tx-2',
          datetime: withdrawalTime,
          timestamp: new Date(withdrawalTime).getTime(),
          source: 'kraken',
          sourceType: 'exchange',
          status: 'success',
          operation: { category: 'transfer', type: 'withdrawal' },
          movements: {
            outflows: [
              {
                assetId: 'exchange:kraken:btc',
                assetSymbol: 'BTC' as Currency,
                grossAmount: new Decimal('1'),
                priceAtTxTime: {
                  price: { amount: new Decimal('50000'), currency: 'USD' as Currency },
                  source: 'derived-trade',
                  fetchedAt: baseTime,
                  granularity: 'exact',
                },
              },
            ],
          },
          fees: [],
        },
        krakenAccountId
      );
      if (withdrawalResult.isErr()) throw withdrawalResult.error;
      const withdrawalTxId = withdrawalResult.value;

      // BTC deposit on Bitcoin blockchain — no price yet
      const depositSaveResult = await db.transactions.save(
        {
          externalId: 'tx-3',
          datetime: depositTime,
          timestamp: new Date(depositTime).getTime(),
          source: 'bitcoin',
          sourceType: 'blockchain',
          status: 'success',
          operation: { category: 'transfer', type: 'deposit' },
          blockchain: {
            name: 'bitcoin',
            transaction_hash: 'mock-hash-3',
            is_confirmed: true,
            block_height: 123_459,
          },
          movements: {
            inflows: [
              {
                assetId: 'blockchain:bitcoin:native',
                assetSymbol: 'BTC' as Currency,
                grossAmount: new Decimal('0.999'),
              },
            ],
          },
          fees: [],
        },
        btcAccountId
      );
      if (depositSaveResult.isErr()) throw depositSaveResult.error;
      const depositTxId = depositSaveResult.value;

      // Confirmed link: withdrawal → deposit
      const linkResult = await db.transactionLinks.create({
        sourceTransactionId: withdrawalTxId,
        targetTransactionId: depositTxId,
        assetSymbol: 'BTC' as Currency,
        sourceAssetId: 'exchange:kraken:btc',
        targetAssetId: 'blockchain:bitcoin:native',
        sourceAmount: new Decimal('1'),
        targetAmount: new Decimal('0.999'),
        linkType: 'exchange_to_blockchain',
        confidenceScore: new Decimal('0.95'),
        matchCriteria: {
          assetMatch: true,
          amountSimilarity: new Decimal('0.999'),
          timingValid: true,
          timingHours: 0.033,
        },
        status: 'confirmed',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      if (linkResult.isErr()) throw linkResult.error;

      const service = createService(db);
      const result = await service.derivePrices();

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().transactionsUpdated).toBeGreaterThanOrEqual(1);

      // Verify deposit movement received link-propagated price
      const depositTxResult = await db.transactions.findById(depositTxId);
      expect(depositTxResult.isOk()).toBe(true);
      const depositTx = depositTxResult._unsafeUnwrap();
      expect(depositTx?.movements.inflows?.[0]?.priceAtTxTime?.source).toBe('link-propagated');
    });

    it('should not propagate prices from suggested (unconfirmed) links', async () => {
      const { accountId } = await setupPrerequisites(db);
      const baseTime = new Date('2024-01-01T10:00:00.000Z');

      // tx1: BTC withdrawal — priced outflow
      const tx1Result = await db.transactions.save(
        {
          externalId: 'tx-1',
          datetime: baseTime.toISOString(),
          timestamp: baseTime.getTime(),
          source: 'kraken',
          sourceType: 'exchange',
          status: 'success',
          operation: { category: 'transfer', type: 'withdrawal' },
          movements: {
            outflows: [
              {
                assetId: 'exchange:kraken:btc',
                assetSymbol: 'BTC' as Currency,
                grossAmount: new Decimal('1'),
                priceAtTxTime: {
                  price: { amount: new Decimal('50000'), currency: 'USD' as Currency },
                  source: 'derived-trade',
                  fetchedAt: baseTime,
                  granularity: 'exact',
                },
              },
            ],
          },
          fees: [],
        },
        accountId
      );
      if (tx1Result.isErr()) throw tx1Result.error;
      const tx1Id = tx1Result.value;

      // tx2: BTC deposit — no price
      const tx2Result = await db.transactions.save(
        {
          externalId: 'tx-2',
          datetime: new Date(baseTime.getTime() + 60_000).toISOString(),
          timestamp: baseTime.getTime() + 60_000,
          source: 'kraken',
          sourceType: 'exchange',
          status: 'success',
          operation: { category: 'transfer', type: 'deposit' },
          movements: {
            inflows: [
              { assetId: 'exchange:kraken:btc', assetSymbol: 'BTC' as Currency, grossAmount: new Decimal('0.999') },
            ],
          },
          fees: [],
        },
        accountId
      );
      if (tx2Result.isErr()) throw tx2Result.error;
      const tx2Id = tx2Result.value;

      // Suggested link only (should NOT trigger price propagation)
      const linkResult = await db.transactionLinks.create({
        sourceTransactionId: tx1Id,
        targetTransactionId: tx2Id,
        assetSymbol: 'BTC' as Currency,
        sourceAssetId: 'exchange:kraken:btc',
        targetAssetId: 'exchange:kraken:btc',
        sourceAmount: new Decimal('1'),
        targetAmount: new Decimal('0.999'),
        linkType: 'exchange_to_exchange',
        confidenceScore: new Decimal('0.85'),
        matchCriteria: {
          assetMatch: true,
          amountSimilarity: new Decimal('0.999'),
          timingValid: true,
          timingHours: 0.017,
        },
        status: 'suggested',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      if (linkResult.isErr()) throw linkResult.error;

      const service = createService(db);
      await service.derivePrices();

      // tx2's inflow must remain unpriced (suggested link ignored)
      const tx2TxResult = await db.transactions.findById(tx2Id);
      expect(tx2TxResult.isOk()).toBe(true);
      const tx2Tx = tx2TxResult._unsafeUnwrap();
      expect(tx2Tx?.movements.inflows?.[0]?.priceAtTxTime).toBeUndefined();
    });
  });

  describe('Edge Cases', () => {
    it('should handle transactions with no movements', async () => {
      const { accountId } = await setupPrerequisites(db);

      const txResult = await db.transactions.save(
        {
          externalId: 'tx-1',
          datetime: '2024-01-01T10:00:00.000Z',
          timestamp: new Date('2024-01-01T10:00:00.000Z').getTime(),
          source: 'kraken',
          sourceType: 'exchange',
          status: 'success',
          operation: { category: 'transfer', type: 'deposit' },
          movements: { inflows: [], outflows: [] },
          fees: [],
        },
        accountId
      );
      if (txResult.isErr()) throw txResult.error;

      const service = createService(db);
      const result = await service.derivePrices();

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().transactionsUpdated).toBe(0);
    });
  });
});
