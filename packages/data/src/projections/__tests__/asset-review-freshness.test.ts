import { assertOk } from '@exitbook/foundation/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DataSession } from '../../data-session.js';
import type { KyselyDB } from '../../database.js';
import { buildAssetReviewFreshnessPorts } from '../../projections/asset-review-freshness.js';
import { buildProfileProjectionScopeKey } from '../../projections/profile-scope-key.js';
import {
  seedAccount,
  seedImportSession,
  seedTxFingerprint,
  seedProfile,
} from '../../repositories/__tests__/helpers.js';
import { ProjectionStateRepository } from '../../repositories/projection-state-repository.js';
import { createTestDatabase } from '../../utils/test-utils.js';

const PROFILE_ID = 1;

describe('buildAssetReviewFreshnessPorts', () => {
  let db: KyselyDB;
  let ctx: DataSession;

  beforeEach(async () => {
    db = await createTestDatabase();
    ctx = new DataSession(db);
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
        platform_key: 'test',
        platform_kind: 'blockchain',
        tx_fingerprint: seedTxFingerprint('test', accountId, identityReference),
        transaction_status: 'success',
        transaction_datetime: '2025-01-01T00:00:00.000Z',
        excluded_from_accounting: false,
        created_at: new Date().toISOString(),
      })
      .execute();
  }

  it('returns fresh when no processed transactions exist', async () => {
    const freshness = buildAssetReviewFreshnessPorts(ctx, PROFILE_ID);
    const result = assertOk(await freshness.checkFreshness());
    expect(result.status).toBe('fresh');
  });

  it('returns stale when processed transactions exist but asset review has never been built', async () => {
    await seedProfile(db);
    await seedAccount(db, 1, 'blockchain', 'ethereum');
    await seedImportSession(db, 1, 1);
    await seedTransaction(1);

    const freshness = buildAssetReviewFreshnessPorts(ctx, PROFILE_ID);
    const result = assertOk(await freshness.checkFreshness());
    expect(result.status).toBe('stale');
    expect(result.reason).toBe('asset review has never been built');
  });

  it('trusts fresh projection state when asset review is marked fresh', async () => {
    await seedProfile(db);
    await seedAccount(db, 1, 'blockchain', 'ethereum');
    await seedImportSession(db, 1, 1);
    await seedTransaction(1);
    assertOk(await ctx.assetReview.replaceAll(PROFILE_ID, []));

    const repo = new ProjectionStateRepository(db);
    assertOk(await repo.markFresh('asset-review', { assetCount: 0 }, buildProfileProjectionScopeKey(PROFILE_ID)));

    const freshness = buildAssetReviewFreshnessPorts(ctx, PROFILE_ID);
    const result = assertOk(await freshness.checkFreshness());
    expect(result.status).toBe('fresh');
  });

  it('returns stale when projection state is explicitly stale', async () => {
    const repo = new ProjectionStateRepository(db);
    assertOk(await repo.markStale('asset-review', 'override:confirm', buildProfileProjectionScopeKey(PROFILE_ID)));

    const freshness = buildAssetReviewFreshnessPorts(ctx, PROFILE_ID);
    const result = assertOk(await freshness.checkFreshness());
    expect(result.status).toBe('stale');
    expect(result.reason).toBe('override:confirm');
  });
});
