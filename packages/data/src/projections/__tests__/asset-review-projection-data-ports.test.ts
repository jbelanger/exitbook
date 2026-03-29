import type { AssetReviewSummary } from '@exitbook/core';
import { assertOk } from '@exitbook/foundation/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DataSession } from '../../data-session.js';
import type { KyselyDB } from '../../database.js';
import { buildAssetReviewProjectionDataPorts } from '../../projections/asset-review-projection-data-ports.js';
import { buildProfileProjectionScopeKey } from '../../projections/profile-scope-key.js';
import { seedProfile } from '../../repositories/__tests__/helpers.js';
import { createTestDatabase } from '../../utils/test-utils.js';

const PROFILE_ID = 1;

describe('buildAssetReviewProjectionDataPorts', () => {
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

  it('replaces the asset review projection and marks it fresh in one transaction', async () => {
    const ports = buildAssetReviewProjectionDataPorts(ctx, PROFILE_ID);
    const summary: AssetReviewSummary = {
      assetId: 'blockchain:ethereum:0xaaa',
      reviewStatus: 'needs-review',
      referenceStatus: 'unknown',
      evidenceFingerprint: 'fingerprint-1',
      confirmationIsStale: false,
      accountingBlocked: true,
      warningSummary: 'Ambiguous token symbol',
      evidence: [
        {
          kind: 'same-symbol-ambiguity',
          severity: 'error',
          message: 'Ambiguous symbol across contracts',
          metadata: {
            chain: 'ethereum',
            conflictingAssetIds: ['blockchain:ethereum:0xaaa', 'blockchain:ethereum:0xbbb'],
          },
        },
      ],
    };

    assertOk(await ports.markAssetReviewBuilding());
    assertOk(await ports.replaceAssetReviewProjection([summary], { assetCount: 1 }));

    const persisted = assertOk(await ctx.assetReview.listAll(PROFILE_ID));
    expect(persisted).toEqual([summary]);

    const state = assertOk(await ctx.projectionState.find('asset-review', buildProfileProjectionScopeKey(PROFILE_ID)));
    expect(state).toMatchObject({
      projectionId: 'asset-review',
      scopeKey: buildProfileProjectionScopeKey(PROFILE_ID),
      status: 'fresh',
      metadata: { assetCount: 1 },
    });
    expect(state?.invalidatedBy ?? undefined).toBeUndefined();
  });
});
