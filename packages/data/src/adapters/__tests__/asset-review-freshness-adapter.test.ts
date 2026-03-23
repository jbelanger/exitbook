import { assertOk } from '@exitbook/foundation/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DataContext } from '../../data-context.js';
import type { KyselyDB } from '../../database.js';
import { seedAccount, seedImportSession, seedTxFingerprint, seedUser } from '../../repositories/__tests__/helpers.js';
import { ProjectionStateRepository } from '../../repositories/projection-state-repository.js';
import { createTestDatabase } from '../../utils/test-utils.js';
import { buildAssetReviewFreshnessPorts } from '../asset-review-freshness-adapter.js';

describe('buildAssetReviewFreshnessPorts', () => {
  let db: KyselyDB;
  let ctx: DataContext;

  beforeEach(async () => {
    db = await createTestDatabase();
    ctx = new DataContext(db);
  });

  afterEach(async () => {
    await db.destroy();
  });

  async function seedTransaction(accountId: number) {
    const identityReference = `test-tx-${accountId}`;
    await db
      .insertInto('transactions')
      .values({
        account_id: accountId,
        source_name: 'test',
        source_type: 'blockchain',
        tx_fingerprint: seedTxFingerprint('test', accountId, identityReference),
        transaction_status: 'success',
        transaction_datetime: '2025-01-01T00:00:00.000Z',
        is_spam: false,
        excluded_from_accounting: false,
        created_at: new Date().toISOString(),
      })
      .execute();
  }

  it('returns fresh when no processed transactions exist', async () => {
    const freshness = buildAssetReviewFreshnessPorts(ctx);
    const result = assertOk(await freshness.checkFreshness());
    expect(result.status).toBe('fresh');
  });

  it('returns stale when processed transactions exist but asset review has never been built', async () => {
    await seedUser(db);
    await seedAccount(db, 1, 'blockchain', 'ethereum');
    await seedImportSession(db, 1, 1);
    await seedTransaction(1);

    const freshness = buildAssetReviewFreshnessPorts(ctx);
    const result = assertOk(await freshness.checkFreshness());
    expect(result.status).toBe('stale');
    expect(result.reason).toBe('asset review has never been built');
  });

  it('trusts fresh projection state when asset review is marked fresh', async () => {
    await seedUser(db);
    await seedAccount(db, 1, 'blockchain', 'ethereum');
    await seedImportSession(db, 1, 1);
    await seedTransaction(1);
    assertOk(await ctx.assetReview.replaceAll([]));

    const repo = new ProjectionStateRepository(db);
    assertOk(await repo.markFresh('asset-review', { assetCount: 0 }));

    const freshness = buildAssetReviewFreshnessPorts(ctx);
    const result = assertOk(await freshness.checkFreshness());
    expect(result.status).toBe('fresh');
  });

  it('returns stale when projection state is explicitly stale', async () => {
    const repo = new ProjectionStateRepository(db);
    assertOk(await repo.markStale('asset-review', 'override:confirm'));

    const freshness = buildAssetReviewFreshnessPorts(ctx);
    const result = assertOk(await freshness.checkFreshness());
    expect(result.status).toBe('stale');
    expect(result.reason).toBe('override:confirm');
  });
});
