/* eslint-disable unicorn/no-null -- test fixtures use raw db inserts */
import type { TransactionDraft } from '@exitbook/core';
import { type Currency, parseDecimal } from '@exitbook/foundation';
import { assertOk } from '@exitbook/foundation/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { KyselyDB } from '../../database.js';
import { createTestDatabase } from '../../utils/test-utils.js';
import { TransactionRepository } from '../transaction-repository.js';

import { seedAccount, seedImportSession, seedProfile } from './helpers.js';

describe('TransactionRepository raw bindings', () => {
  let db: KyselyDB;
  let repo: TransactionRepository;

  beforeEach(async () => {
    db = await createTestDatabase();
    repo = new TransactionRepository(db);

    await seedProfile(db);
    await seedAccount(db, 1, 'exchange-api', 'kraken');
    await seedAccount(db, 2, 'exchange-api', 'coinbase');
    await seedImportSession(db, 1, 1);
    await seedImportSession(db, 2, 2);
  });

  afterEach(async () => {
    await db.destroy();
  });

  it('persists raw transaction lineage when saving a processed transaction', async () => {
    await insertRawTransaction(101, 'evt-1');
    await insertRawTransaction(102, 'evt-2');

    const transactionId = assertOk(
      await repo.create(
        {
          datetime: '2026-03-01T12:00:00.000Z',
          fees: [],
          identityMaterial: {
            componentEventIds: ['evt-1', 'evt-2'],
          },
          movements: {
            inflows: [
              {
                assetId: 'asset:btc',
                assetSymbol: 'BTC' as Currency,
                grossAmount: parseDecimal('1'),
                netAmount: parseDecimal('1'),
              },
            ],
            outflows: [],
          },
          operation: { category: 'trade', type: 'buy' },
          platformKey: 'kraken',
          platformKind: 'exchange',
          status: 'success',
          timestamp: Date.parse('2026-03-01T12:00:00.000Z'),
        },
        1,
        [101, 102]
      )
    );

    const bindingRows = await db
      .selectFrom('transaction_raw_bindings')
      .selectAll()
      .where('transaction_id', '=', transactionId)
      .orderBy('raw_transaction_id', 'asc')
      .execute();

    expect(bindingRows).toEqual([
      { raw_transaction_id: 101, transaction_id: transactionId },
      { raw_transaction_id: 102, transaction_id: transactionId },
    ]);
  });

  it('adds raw bindings for duplicate processed transactions without duplicating movement rows', async () => {
    await insertRawTransaction(201, 'evt-1');
    await insertRawTransaction(202, 'evt-2');

    const transactionDraft: TransactionDraft = {
      datetime: '2026-03-01T12:00:00.000Z',
      fees: [],
      identityMaterial: {
        componentEventIds: ['evt-1'],
      },
      movements: {
        inflows: [
          {
            assetId: 'asset:btc',
            assetSymbol: 'BTC' as Currency,
            grossAmount: parseDecimal('1'),
            netAmount: parseDecimal('1'),
          },
        ],
        outflows: [],
      },
      operation: { category: 'transfer', type: 'deposit' },
      platformKey: 'kraken',
      platformKind: 'exchange' as const,
      status: 'success' as const,
      timestamp: Date.parse('2026-03-01T12:00:00.000Z'),
    };

    const firstId = assertOk(await repo.create(transactionDraft, 1, [201]));
    const secondId = assertOk(await repo.create(transactionDraft, 1, [201, 202]));

    expect(secondId).toBe(firstId);

    const bindingRows = await db
      .selectFrom('transaction_raw_bindings')
      .selectAll()
      .where('transaction_id', '=', firstId)
      .orderBy('raw_transaction_id', 'asc')
      .execute();
    expect(bindingRows).toEqual([
      { raw_transaction_id: 201, transaction_id: firstId },
      { raw_transaction_id: 202, transaction_id: firstId },
    ]);

    const movementRows = await db
      .selectFrom('transaction_movements')
      .selectAll()
      .where('transaction_id', '=', firstId)
      .execute();
    expect(movementRows).toHaveLength(1);
  });

  it('loads linked raw transactions for a processed transaction', async () => {
    await insertRawTransaction(301, 'evt-a', {
      providerData: { amount: '1.5' },
      timestamp: Date.parse('2026-03-01T10:00:00.000Z'),
    });
    await insertRawTransaction(302, 'evt-b', {
      providerData: { fee: '0.01' },
      timestamp: Date.parse('2026-03-01T10:05:00.000Z'),
    });

    const transactionId = assertOk(
      await repo.create(
        {
          datetime: '2026-03-01T12:00:00.000Z',
          fees: [],
          identityMaterial: {
            componentEventIds: ['evt-a', 'evt-b'],
          },
          movements: {
            inflows: [
              {
                assetId: 'asset:btc',
                assetSymbol: 'BTC' as Currency,
                grossAmount: parseDecimal('1.5'),
                netAmount: parseDecimal('1.5'),
              },
            ],
            outflows: [],
          },
          operation: { category: 'trade', type: 'buy' },
          platformKey: 'kraken',
          platformKind: 'exchange',
          status: 'success',
          timestamp: Date.parse('2026-03-01T12:00:00.000Z'),
        },
        1,
        [301, 302]
      )
    );

    const rawTransactions = assertOk(await repo.findRawTransactionsByTransactionId(transactionId, 1));

    expect(rawTransactions.map((rawTransaction) => rawTransaction.id)).toEqual([301, 302]);
    expect(rawTransactions[0]?.providerData).toEqual({ amount: '1.5' });
    expect(rawTransactions[1]?.providerData).toEqual({ fee: '0.01' });
  });

  it('rejects raw lineage rows from a different owning account', async () => {
    await insertRawTransaction(401, 'evt-owned', { accountId: 1 });
    await insertRawTransaction(402, 'evt-foreign', { accountId: 2 });

    const result = await repo.create(
      {
        datetime: '2026-03-01T12:00:00.000Z',
        fees: [],
        identityMaterial: {
          componentEventIds: ['evt-owned'],
        },
        movements: {
          inflows: [
            {
              assetId: 'asset:btc',
              assetSymbol: 'BTC' as Currency,
              grossAmount: parseDecimal('1'),
              netAmount: parseDecimal('1'),
            },
          ],
          outflows: [],
        },
        operation: { category: 'trade', type: 'buy' },
        platformKey: 'kraken',
        platformKind: 'exchange',
        status: 'success',
        timestamp: Date.parse('2026-03-01T12:00:00.000Z'),
      },
      1,
      [401, 402]
    );

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('outside the owning account');
      expect(result.error.message).toContain('402');
    }
  });

  async function insertRawTransaction(
    id: number,
    eventId: string,
    overrides?: {
      accountId?: number | undefined;
      providerData?: unknown;
      timestamp?: number | undefined;
    }
  ): Promise<void> {
    await db
      .insertInto('raw_transactions')
      .values({
        account_id: overrides?.accountId ?? 1,
        blockchain_transaction_hash: null,
        created_at: new Date('2026-03-01T00:00:00.000Z').toISOString(),
        event_id: eventId,
        id,
        normalized_data: JSON.stringify({ eventId }),
        processed_at: null,
        processing_status: 'pending',
        provider_data: JSON.stringify(overrides?.providerData ?? { eventId }),
        provider_name: 'kraken',
        source_address: null,
        timestamp: overrides?.timestamp ?? Date.parse('2026-03-01T00:00:00.000Z'),
        transaction_type_hint: 'trade',
      })
      .execute();
  }
});
