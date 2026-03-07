import { assertOk } from '@exitbook/core/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DataContext } from '../../data-context.js';
import type { KyselyDB } from '../../database.js';
import { seedUser, seedAccount } from '../../repositories/__tests__/helpers.js';
import { ProjectionStateRepository } from '../../repositories/projection-state-repository.js';
import { createTestDatabase } from '../../utils/test-utils.js';
import { buildLinksFreshnessPorts } from '../links-freshness-adapter.js';

describe('buildLinksFreshnessPorts', () => {
  let db: KyselyDB;
  let ctx: DataContext;

  beforeEach(async () => {
    db = await createTestDatabase();
    ctx = new DataContext(db);
  });

  afterEach(async () => {
    await db.destroy();
  });

  async function seedTransaction(accountId: number, createdAt: string) {
    await db
      .insertInto('transactions')
      .values({
        account_id: accountId,
        source_name: 'test',
        source_type: 'exchange',
        transaction_status: 'success',
        transaction_datetime: '2025-01-01T00:00:00.000Z',
        is_spam: false,
        excluded_from_accounting: false,
        created_at: createdAt,
      })
      .execute();
  }

  async function seedLink(createdAt: string) {
    const txs = await db.selectFrom('transactions').selectAll().execute();
    if (txs.length < 2) throw new Error('Need at least 2 transactions to create a link');

    await db
      .insertInto('transaction_links')
      .values({
        source_transaction_id: txs[0]!.id,
        target_transaction_id: txs[1]!.id,
        asset: 'BTC',
        source_amount: '1.0',
        target_amount: '1.0',
        link_type: 'exchange_to_blockchain',
        confidence_score: '1.0',
        match_criteria_json: JSON.stringify({
          assetMatch: true,
          timingValid: true,
          timingHours: 1,
          amountSimilarity: 0.95,
        }),
        status: 'confirmed',
        created_at: createdAt,
        updated_at: createdAt,
      })
      .execute();
  }

  it('returns fresh when no transactions exist', async () => {
    const freshness = buildLinksFreshnessPorts(ctx);
    const result = assertOk(await freshness.checkFreshness());
    expect(result.status).toBe('fresh');
    expect(result.reason).toBeUndefined();
  });

  it('returns stale when transactions exist but no links', async () => {
    await seedUser(db);
    await seedAccount(db, 1, 'exchange-api', 'kraken');
    await seedTransaction(1, '2025-06-01T00:00:00.000Z');

    const freshness = buildLinksFreshnessPorts(ctx);
    const result = assertOk(await freshness.checkFreshness());
    expect(result.status).toBe('stale');
    expect(result.reason).toBe('no links exist');
  });

  it('returns stale when newest transaction is newer than newest link', async () => {
    await seedUser(db);
    await seedAccount(db, 1, 'exchange-api', 'kraken');
    await seedAccount(db, 2, 'exchange-api', 'coinbase');
    await seedTransaction(1, '2025-06-01T00:00:00.000Z');
    await seedTransaction(2, '2025-06-01T00:00:00.000Z');
    await seedLink('2025-06-01T00:00:00.000Z');

    // Add a newer transaction
    await seedTransaction(1, '2025-07-01T00:00:00.000Z');

    const freshness = buildLinksFreshnessPorts(ctx);
    const result = assertOk(await freshness.checkFreshness());
    expect(result.status).toBe('stale');
    expect(result.reason).toBe('new transactions since last linking');
  });

  it('returns fresh when links are newer than transactions', async () => {
    await seedUser(db);
    await seedAccount(db, 1, 'exchange-api', 'kraken');
    await seedAccount(db, 2, 'exchange-api', 'coinbase');
    await seedTransaction(1, '2025-06-01T00:00:00.000Z');
    await seedTransaction(2, '2025-06-01T00:00:00.000Z');
    await seedLink('2025-07-01T00:00:00.000Z');

    const freshness = buildLinksFreshnessPorts(ctx);
    const result = assertOk(await freshness.checkFreshness());
    expect(result.status).toBe('fresh');
  });

  it('returns stale when projection state is explicitly stale', async () => {
    const repo = new ProjectionStateRepository(db);
    assertOk(await repo.markStale('links', 'upstream-rebuild'));

    const freshness = buildLinksFreshnessPorts(ctx);
    const result = assertOk(await freshness.checkFreshness());
    expect(result.status).toBe('stale');
    expect(result.reason).toBe('upstream-rebuild');
  });

  it('returns failed status from projection state', async () => {
    const repo = new ProjectionStateRepository(db);
    assertOk(await repo.markFailed('links'));

    const freshness = buildLinksFreshnessPorts(ctx);
    const result = assertOk(await freshness.checkFreshness());
    expect(result.status).toBe('failed');
  });
});
