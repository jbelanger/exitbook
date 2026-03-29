import { assertOk } from '@exitbook/foundation/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DataSession } from '../../data-session.js';
import type { KyselyDB } from '../../database.js';
import { buildAssetReviewResetPorts } from '../../projections/asset-review-reset.js';
import { buildProfileProjectionScopeKey } from '../../projections/profile-scope-key.js';
import { seedProfile } from '../../repositories/__tests__/helpers.js';
import { createTestDatabase } from '../../utils/test-utils.js';

const PROFILE_ID = 1;

describe('buildAssetReviewResetPorts', () => {
  let db: KyselyDB;
  let ctx: DataSession;

  beforeEach(async () => {
    db = await createTestDatabase();
    ctx = new DataSession(db);
    await seedProfile(db);
  });

  afterEach(async () => {
    await db.destroy();
  });

  it('counts and clears the persisted asset review projection', async () => {
    assertOk(
      await ctx.assetReview.replaceAll(PROFILE_ID, [
        {
          assetId: 'blockchain:ethereum:0xscam',
          reviewStatus: 'needs-review',
          referenceStatus: 'unknown',
          evidenceFingerprint: 'asset-review:v1:1',
          confirmationIsStale: false,
          accountingBlocked: true,
          warningSummary: 'warning',
          evidence: [
            {
              kind: 'spam-flag',
              severity: 'error',
              message: 'spam',
            },
          ],
        },
      ])
    );

    const reset = buildAssetReviewResetPorts(ctx);
    expect(assertOk(await reset.countResetImpact()).assets).toBe(1);

    const impact = assertOk(await reset.reset());
    expect(impact.assets).toBe(1);
    expect(assertOk(await ctx.assetReview.countStates(PROFILE_ID))).toBe(0);

    const state = assertOk(await ctx.projectionState.find('asset-review', buildProfileProjectionScopeKey(PROFILE_ID)));
    expect(state?.status).toBe('stale');
    expect(state?.invalidatedBy).toBe('reset');
  });
});
