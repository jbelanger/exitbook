import type { CostBasisFailureSnapshotRecord } from '@exitbook/accounting/ports';
import { assertOk } from '@exitbook/core/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { KyselyDB } from '../../database.js';
import { createTestDatabase } from '../../utils/test-utils.js';
import { CostBasisFailureSnapshotRepository } from '../cost-basis-failure-snapshot-repository.js';

function createSnapshot(
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
    exclusionFingerprint: 'excluded-assets:none',
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

async function loadSnapshotRow(db: KyselyDB, scopeKey: string, consumer: CostBasisFailureSnapshotRecord['consumer']) {
  return db
    .selectFrom('cost_basis_failure_snapshots')
    .selectAll()
    .where('scope_key', '=', scopeKey)
    .where('consumer', '=', consumer)
    .executeTakeFirst();
}

describe('CostBasisFailureSnapshotRepository', () => {
  let db: KyselyDB;
  let repo: CostBasisFailureSnapshotRepository;

  beforeEach(async () => {
    db = await createTestDatabase();
    repo = new CostBasisFailureSnapshotRepository(db);
  });

  afterEach(async () => {
    await db.destroy();
  });

  it('replaces the latest failure snapshot for a scope and consumer', async () => {
    assertOk(await repo.replaceLatest(createSnapshot('scope-a', 'cost-basis', 'snapshot-1')));

    const row = await loadSnapshotRow(db, 'scope-a', 'cost-basis');
    expect(row).toBeDefined();
    expect(row?.snapshot_id).toBe('snapshot-1');
    expect(row?.consumer).toBe('cost-basis');
    expect(row?.prices_last_mutated_at).toBe('2026-03-14T12:00:02.000Z');
  });

  it('keeps separate latest failure snapshots per consumer', async () => {
    assertOk(await repo.replaceLatest(createSnapshot('scope-a', 'cost-basis', 'snapshot-1')));
    assertOk(await repo.replaceLatest(createSnapshot('scope-a', 'portfolio', 'snapshot-2')));

    expect((await loadSnapshotRow(db, 'scope-a', 'cost-basis'))?.snapshot_id).toBe('snapshot-1');
    expect((await loadSnapshotRow(db, 'scope-a', 'portfolio'))?.snapshot_id).toBe('snapshot-2');
    expect(assertOk(await repo.count())).toBe(2);
  });

  it('preserves created_at when replacing an existing latest failure snapshot', async () => {
    const firstSnapshot = createSnapshot('scope-a', 'cost-basis', 'snapshot-1');
    firstSnapshot.createdAt = new Date('2026-03-14T12:00:02.000Z');
    firstSnapshot.updatedAt = new Date('2026-03-14T12:00:02.000Z');

    const replacementSnapshot = createSnapshot('scope-a', 'cost-basis', 'snapshot-2');
    replacementSnapshot.createdAt = new Date('2026-03-14T12:05:00.000Z');
    replacementSnapshot.updatedAt = new Date('2026-03-14T12:06:00.000Z');

    assertOk(await repo.replaceLatest(firstSnapshot));
    assertOk(await repo.replaceLatest(replacementSnapshot));

    const row = await loadSnapshotRow(db, 'scope-a', 'cost-basis');
    expect(row?.snapshot_id).toBe('snapshot-2');
    expect(row?.created_at).toBe('2026-03-14T12:00:02.000Z');
    expect(row?.updated_at).toBe('2026-03-14T12:06:00.000Z');
  });

  it('deletes latest failure snapshots', async () => {
    assertOk(await repo.replaceLatest(createSnapshot('scope-a', 'cost-basis', 'snapshot-1')));
    assertOk(await repo.replaceLatest(createSnapshot('scope-b', 'portfolio', 'snapshot-2')));

    expect(assertOk(await repo.deleteLatest(['scope-a']))).toBe(1);
    expect(await loadSnapshotRow(db, 'scope-a', 'cost-basis')).toBeUndefined();
    expect((await loadSnapshotRow(db, 'scope-b', 'portfolio'))?.snapshot_id).toBe('snapshot-2');
  });
});
