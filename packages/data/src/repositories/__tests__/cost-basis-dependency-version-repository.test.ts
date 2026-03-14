import { assertOk } from '@exitbook/core/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { KyselyDB } from '../../database.js';
import { createTestDatabase } from '../../utils/test-utils.js';
import { CostBasisDependencyVersionRepository } from '../cost-basis-dependency-version-repository.js';

describe('CostBasisDependencyVersionRepository', () => {
  let db: KyselyDB;
  let repo: CostBasisDependencyVersionRepository;

  beforeEach(async () => {
    db = await createTestDatabase();
    repo = new CostBasisDependencyVersionRepository(db);
  });

  afterEach(async () => {
    await db.destroy();
  });

  it('returns version zero for a dependency with no row', async () => {
    const row = assertOk(await repo.getVersion('prices'));
    expect(row.version).toBe(0);
    expect(row.lastMutatedAt).toEqual(new Date(0));
  });

  it('bumps and persists dependency versions', async () => {
    const first = assertOk(await repo.bumpVersion('prices'));
    const second = assertOk(await repo.bumpVersion('prices'));
    const current = assertOk(await repo.getVersion('prices'));

    expect(first.version).toBe(1);
    expect(second.version).toBe(2);
    expect(current.version).toBe(2);
    expect(current.lastMutatedAt).toBeInstanceOf(Date);
  });
});
