import { assertOk } from '@exitbook/core/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DataContext } from '../../data-context.js';
import type { KyselyDB } from '../../database.js';
import { seedAccount, seedImportSession, seedTxFingerprint, seedUser } from '../../repositories/__tests__/helpers.js';
import { createTestDatabase } from '../../utils/test-utils.js';
import { buildProcessedTransactionsResetPorts } from '../processed-transactions-reset-adapter.js';

describe('buildProcessedTransactionsResetPorts', () => {
  let db: KyselyDB;
  let ctx: DataContext;

  beforeEach(async () => {
    db = await createTestDatabase();
    ctx = new DataContext(db);
    await seedUser(db);
    await seedAccount(db, 1, 'blockchain', 'bitcoin');
    await seedImportSession(db, 1, 1);
  });

  afterEach(async () => {
    await db.destroy();
  });

  async function seedRawTransaction(accountId: number, status: 'pending' | 'processed' = 'processed') {
    await db
      .insertInto('raw_transactions')
      .values({
        account_id: accountId,
        provider_name: 'test',
        event_id: `event-${globalThis.crypto.randomUUID()}`,
        timestamp: Date.now(),
        provider_data: '{}',
        normalized_data: '{}',
        processing_status: status,
        created_at: new Date().toISOString(),
      })
      .execute();
  }

  async function seedTransaction(accountId: number) {
    const externalId = `test-tx-${accountId}-${globalThis.crypto.randomUUID()}`;
    const result = await db
      .insertInto('transactions')
      .values({
        account_id: accountId,
        source_name: 'test',
        source_type: 'blockchain',
        external_id: externalId,
        tx_fingerprint: seedTxFingerprint('test', accountId, externalId),
        transaction_status: 'success',
        transaction_datetime: '2025-01-01T00:00:00.000Z',
        is_spam: false,
        excluded_from_accounting: false,
        created_at: new Date().toISOString(),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return result.id;
  }

  it('counts impact correctly', async () => {
    await seedTransaction(1);
    await seedTransaction(1);

    const reset = buildProcessedTransactionsResetPorts(ctx);
    const impact = assertOk(await reset.countResetImpact());
    expect(impact.transactions).toBe(2);
  });

  it('resets all data and marks raw as pending', async () => {
    await seedRawTransaction(1, 'processed');
    await seedTransaction(1);
    await seedTransaction(1);

    const reset = buildProcessedTransactionsResetPorts(ctx);
    const impact = assertOk(await reset.reset());

    expect(impact.transactions).toBe(2);

    // Verify transactions are deleted
    const txCount = assertOk(await ctx.transactions.count({ includeExcluded: true }));
    expect(txCount).toBe(0);

    // Verify raw data is reset to pending
    const rawRows = await db.selectFrom('raw_transactions').selectAll().execute();
    for (const row of rawRows) {
      expect(row.processing_status).toBe('pending');
    }

    // Verify projection state is marked stale
    const ptState = assertOk(await ctx.projectionState.get('processed-transactions'));
    expect(ptState!.status).toBe('stale');
    expect(ptState!.invalidatedBy).toBe('reset');

    // Verify downstream projections are also marked stale
    const assetReviewState = assertOk(await ctx.projectionState.get('asset-review'));
    expect(assetReviewState!.status).toBe('stale');
    expect(assetReviewState!.invalidatedBy).toBe('upstream-reset:processed-transactions');

    const linksState = assertOk(await ctx.projectionState.get('links'));
    expect(linksState!.status).toBe('stale');
    expect(linksState!.invalidatedBy).toBe('upstream-reset:processed-transactions');
  });

  it('scopes reset to specific account IDs', async () => {
    await seedAccount(db, 2, 'blockchain', 'bitcoin', { parentAccountId: 1 });
    await seedImportSession(db, 2, 2);
    await seedRawTransaction(1, 'processed');
    await seedRawTransaction(2, 'processed');
    await seedTransaction(1);
    await seedTransaction(2);

    const reset = buildProcessedTransactionsResetPorts(ctx);
    const impact = assertOk(await reset.reset([1]));

    expect(impact.transactions).toBe(1);

    // Account 2 transactions should still exist
    const txCount = assertOk(await ctx.transactions.count({ includeExcluded: true }));
    expect(txCount).toBe(1);

    const parentBalanceState = assertOk(await ctx.projectionState.get('balances', 'balance:1'));
    expect(parentBalanceState?.status).toBe('stale');
    expect(parentBalanceState?.invalidatedBy).toBe('upstream-reset:processed-transactions');

    const childBalanceState = assertOk(await ctx.projectionState.get('balances', 'balance:2'));
    expect(childBalanceState).toBeUndefined();
  });
});
