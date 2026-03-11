import type { AssetReviewSummary } from '@exitbook/core';
import { assertOk } from '@exitbook/core/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DataContext } from '../../data-context.js';
import type { KyselyDB } from '../../database.js';
import { createTestDatabase } from '../../utils/test-utils.js';
import { buildAssetReviewProjectionPorts } from '../asset-review-projection-ports-adapter.js';

describe('buildAssetReviewProjectionPorts', () => {
  let db: KyselyDB;
  let ctx: DataContext;

  beforeEach(async () => {
    db = await createTestDatabase();
    ctx = new DataContext(db);
  });

  afterEach(async () => {
    await db.destroy();
  });

  it('replaces the asset review projection and marks it fresh in one transaction', async () => {
    const ports = buildAssetReviewProjectionPorts(ctx);
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

    const persisted = assertOk(await ctx.assetReview.listAll());
    expect(persisted).toEqual([summary]);

    const state = assertOk(await ctx.projectionState.get('asset-review'));
    expect(state).toMatchObject({
      projectionId: 'asset-review',
      status: 'fresh',
      metadata: { assetCount: 1 },
    });
    expect(state?.invalidatedBy ?? undefined).toBeUndefined();
  });
});
