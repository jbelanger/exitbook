import type { CostBasisSnapshotRecord } from '@exitbook/accounting/ports';
import { assertOk } from '@exitbook/foundation/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { KyselyDB } from '../../database.js';
import { createTestDatabase } from '../../utils/test-utils.js';
import { CostBasisSnapshotRepository } from '../cost-basis-snapshot-repository.js';

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
    exclusionFingerprint: 'excluded-assets:none',
    calculationId: 'calc-1',
    jurisdiction: 'US',
    method: 'fifo',
    taxYear: 2024,
    displayCurrency: 'USD',
    startDate: '2024-01-01T00:00:00.000Z',
    endDate: '2024-12-31T23:59:59.999Z',
    artifactJson:
      '{"kind":"standard-workflow","lots":[],"disposals":[],"lotTransfers":[],"assetsProcessed":[],"lotsCreated":0,"disposalsProcessed":0,"totalCapitalGainLoss":"0","totalTaxableGainLoss":"0","calculation":{"id":"00000000-0000-0000-0000-000000000000","calculationDate":"2026-03-14T12:00:00.000Z","config":{"method":"fifo","currency":"USD","jurisdiction":"US","taxYear":2024,"startDate":"2024-01-01T00:00:00.000Z","endDate":"2024-12-31T23:59:59.999Z"},"startDate":"2024-01-01T00:00:00.000Z","endDate":"2024-12-31T23:59:59.999Z","totalProceeds":"0","totalCostBasis":"0","totalGainLoss":"0","totalTaxableGainLoss":"0","assetsProcessed":[],"transactionsProcessed":0,"lotsCreated":0,"disposalsProcessed":0,"status":"completed","createdAt":"2026-03-14T12:00:00.000Z"}}',
    debugJson: '{"kind":"standard-workflow","inputTransactionIds":[],"appliedConfirmedLinkIds":[]}',
    createdAt: new Date('2026-03-14T12:00:02.000Z'),
    updatedAt: new Date('2026-03-14T12:00:02.000Z'),
  };
}

describe('CostBasisSnapshotRepository', () => {
  let db: KyselyDB;
  let repo: CostBasisSnapshotRepository;

  beforeEach(async () => {
    db = await createTestDatabase();
    repo = new CostBasisSnapshotRepository(db);
  });

  afterEach(async () => {
    await db.destroy();
  });

  it('replaces and reloads the latest snapshot for a scope', async () => {
    assertOk(await repo.replaceLatest(createSnapshot('scope-a', 'snapshot-1')));

    const row = assertOk(await repo.findLatest('scope-a'));
    expect(row).toBeDefined();
    expect(row?.snapshotId).toBe('snapshot-1');
    expect(row?.artifactKind).toBe('standard');
    expect(row?.pricesLastMutatedAt?.toISOString()).toBe('2026-03-14T12:00:02.000Z');
  });

  it('overwrites the prior snapshot for the same scope', async () => {
    assertOk(await repo.replaceLatest(createSnapshot('scope-a', 'snapshot-1')));
    assertOk(await repo.replaceLatest(createSnapshot('scope-a', 'snapshot-2')));

    const row = assertOk(await repo.findLatest('scope-a'));
    expect(row?.snapshotId).toBe('snapshot-2');
    expect(assertOk(await repo.count())).toBe(1);
  });

  it('deletes latest snapshots', async () => {
    assertOk(await repo.replaceLatest(createSnapshot('scope-a', 'snapshot-1')));
    assertOk(await repo.replaceLatest(createSnapshot('scope-b', 'snapshot-2')));

    expect(assertOk(await repo.deleteLatest(['scope-a']))).toBe(1);
    expect(assertOk(await repo.findLatest('scope-a'))).toBeUndefined();
    expect(assertOk(await repo.findLatest('scope-b'))?.snapshotId).toBe('snapshot-2');
  });

  it('counts latest snapshots for the requested scopes only', async () => {
    assertOk(await repo.replaceLatest(createSnapshot('scope-a', 'snapshot-1')));
    assertOk(await repo.replaceLatest(createSnapshot('scope-b', 'snapshot-2')));

    expect(assertOk(await repo.count(['scope-a']))).toBe(1);
    expect(assertOk(await repo.count(['scope-a', 'scope-b']))).toBe(2);
    expect(assertOk(await repo.count(['scope-missing']))).toBe(0);
  });
});
