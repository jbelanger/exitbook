import { assertOk } from '@exitbook/foundation/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DataContext } from '../../data-context.js';
import type { KyselyDB } from '../../database.js';
import { seedAccount, seedUser } from '../../repositories/__tests__/helpers.js';
import { createTestDatabase } from '../../utils/test-utils.js';
import { buildBalancesFreshnessPorts } from '../balances-freshness-adapter.js';

describe('buildBalancesFreshnessPorts', () => {
  let db: KyselyDB;
  let ctx: DataContext;

  beforeEach(async () => {
    db = await createTestDatabase();
    ctx = new DataContext(db);
    await seedUser(db);
    await seedAccount(db, 1, 'blockchain', 'bitcoin');
  });

  afterEach(async () => {
    await db.destroy();
  });

  it('returns stale when no snapshot has been built for the scope', async () => {
    const freshness = buildBalancesFreshnessPorts(ctx);
    const result = assertOk(await freshness.checkFreshness(1));

    expect(result.status).toBe('stale');
    expect(result.reason).toBe('balance snapshot has never been built');
  });

  it('returns stale when the scope projection state is explicitly stale', async () => {
    await ctx.balanceSnapshots.replaceSnapshot({
      snapshot: {
        scopeAccountId: 1,
        verificationStatus: 'match',
        matchCount: 1,
        warningCount: 0,
        mismatchCount: 0,
      },
      assets: [],
    });
    assertOk(await ctx.projectionState.markStale('balances', 'upstream-reset:processed-transactions', 'balance:1'));

    const freshness = buildBalancesFreshnessPorts(ctx);
    const result = assertOk(await freshness.checkFreshness(1));

    expect(result.status).toBe('stale');
    expect(result.reason).toBe('upstream-reset:processed-transactions');
  });

  it('treats an existing snapshot as fresh when no stale state is present', async () => {
    await ctx.balanceSnapshots.replaceSnapshot({
      snapshot: {
        scopeAccountId: 1,
        verificationStatus: 'match',
        matchCount: 1,
        warningCount: 0,
        mismatchCount: 0,
      },
      assets: [],
    });

    const freshness = buildBalancesFreshnessPorts(ctx);
    const result = assertOk(await freshness.checkFreshness(1));

    expect(result.status).toBe('fresh');
    expect(result.reason).toBeUndefined();
  });
});
