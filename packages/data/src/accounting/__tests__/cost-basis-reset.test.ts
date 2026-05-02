import type { CostBasisFailureSnapshotRecord, CostBasisSnapshotRecord } from '@exitbook/accounting/ports';
import { assertOk } from '@exitbook/foundation/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DataSession } from '../../data-session.js';
import type { KyselyDB } from '../../database.js';
import { buildProfileProjectionScopeKey } from '../../projections/profile-scope-key.js';
import { createTestDatabase } from '../../utils/test-utils.js';
import { buildCostBasisResetPorts } from '../cost-basis-reset.js';

function createSnapshot(scopeKey: string, snapshotId: string): CostBasisSnapshotRecord {
  return {
    scopeKey,
    snapshotId,
    storageSchemaVersion: 1,
    calculationEngineVersion: 1,
    artifactKind: 'standard',
    linksBuiltAt: new Date('2026-03-14T12:00:00.000Z'),
    assetReviewBuiltAt: new Date('2026-03-14T12:00:01.000Z'),
    pricesLastMutatedAt: new Date('2026-03-14T12:00:02.000Z'),
    exclusionFingerprint: 'accounting-exclusions:none',
    calculationId: 'calc-1',
    jurisdiction: 'US',
    method: 'fifo',
    taxYear: 2024,
    displayCurrency: 'USD',
    startDate: '2024-01-01T00:00:00.000Z',
    endDate: '2024-12-31T23:59:59.999Z',
    artifactJson: '{"kind":"standard-workflow"}',
    debugJson: '{"stage":"test"}',
    createdAt: new Date('2026-03-14T12:00:02.000Z'),
    updatedAt: new Date('2026-03-14T12:00:02.000Z'),
  };
}

function createFailureSnapshot(
  scopeKey: string,
  consumer: CostBasisFailureSnapshotRecord['consumer'],
  snapshotId: string
): CostBasisFailureSnapshotRecord {
  return {
    scopeKey,
    consumer,
    snapshotId,
    linksStatus: 'fresh',
    linksBuiltAt: new Date('2026-03-14T12:00:00.000Z'),
    assetReviewStatus: 'fresh',
    assetReviewBuiltAt: new Date('2026-03-14T12:00:01.000Z'),
    pricesLastMutatedAt: new Date('2026-03-14T12:00:02.000Z'),
    exclusionFingerprint: 'accounting-exclusions:none',
    jurisdiction: 'US',
    method: 'fifo',
    taxYear: 2024,
    displayCurrency: 'USD',
    startDate: '2024-01-01T00:00:00.000Z',
    endDate: '2024-12-31T23:59:59.999Z',
    errorName: 'Error',
    errorMessage: 'boom',
    errorStack: 'stack',
    debugJson: '{"stage":"test"}',
    createdAt: new Date('2026-03-14T12:00:02.000Z'),
    updatedAt: new Date('2026-03-14T12:00:02.000Z'),
  };
}

describe('buildCostBasisResetPorts', () => {
  let db: KyselyDB;
  let ctx: DataSession;

  beforeEach(async () => {
    db = await createTestDatabase();
    ctx = new DataSession(db);
  });

  afterEach(async () => {
    await db.destroy();
  });

  it('counts scoped snapshots for the requested profiles only', async () => {
    assertOk(
      await ctx.costBasisSnapshots.replaceLatest(createSnapshot(buildProfileProjectionScopeKey(1), 'snapshot-1'))
    );
    assertOk(
      await ctx.costBasisSnapshots.replaceLatest(createSnapshot(buildProfileProjectionScopeKey(2), 'snapshot-2'))
    );
    assertOk(
      await ctx.costBasisFailureSnapshots.replaceLatest(
        createFailureSnapshot(buildProfileProjectionScopeKey(1), 'cost-basis', 'failure-1')
      )
    );

    const ports = buildCostBasisResetPorts(ctx);

    expect(assertOk(await ports.countResetImpact([1])).snapshots).toBe(2);
    expect(assertOk(await ports.countResetImpact([2])).snapshots).toBe(1);
    expect(assertOk(await ports.countResetImpact()).snapshots).toBe(3);
  });

  it('resets scoped snapshots for the requested profiles only', async () => {
    assertOk(
      await ctx.costBasisSnapshots.replaceLatest(createSnapshot(buildProfileProjectionScopeKey(1), 'snapshot-1'))
    );
    assertOk(
      await ctx.costBasisSnapshots.replaceLatest(createSnapshot(buildProfileProjectionScopeKey(2), 'snapshot-2'))
    );
    assertOk(
      await ctx.costBasisFailureSnapshots.replaceLatest(
        createFailureSnapshot(buildProfileProjectionScopeKey(1), 'cost-basis', 'failure-1')
      )
    );

    const ports = buildCostBasisResetPorts(ctx);
    const result = assertOk(await ports.reset([1]));

    expect(result.snapshots).toBe(2);
    expect(assertOk(await ctx.costBasisSnapshots.findLatest(buildProfileProjectionScopeKey(1)))).toBeUndefined();
    expect(assertOk(await ctx.costBasisSnapshots.findLatest(buildProfileProjectionScopeKey(2)))?.snapshotId).toBe(
      'snapshot-2'
    );
    expect(assertOk(await ctx.costBasisFailureSnapshots.count([buildProfileProjectionScopeKey(1)]))).toBe(0);
    expect(assertOk(await ctx.costBasisFailureSnapshots.count([buildProfileProjectionScopeKey(2)]))).toBe(0);
  });
});
