import { assertOk } from '@exitbook/foundation/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DataContext } from '../../data-context.js';
import type { KyselyDB } from '../../database.js';
import { createTestDatabase } from '../../utils/test-utils.js';
import { buildAssetReviewResetPorts } from '../asset-review-reset-adapter.js';

describe('buildAssetReviewResetPorts', () => {
  let db: KyselyDB;
  let ctx: DataContext;

  beforeEach(async () => {
    db = await createTestDatabase();
    ctx = new DataContext(db);
  });

  afterEach(async () => {
    await db.destroy();
  });

  it('counts and clears the persisted asset review projection', async () => {
    assertOk(
      await ctx.assetReview.replaceAll([
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
    expect(assertOk(await ctx.assetReview.countStates())).toBe(0);

    const state = assertOk(await ctx.projectionState.get('asset-review'));
    expect(state?.status).toBe('stale');
    expect(state?.invalidatedBy).toBe('reset');
  });
});
