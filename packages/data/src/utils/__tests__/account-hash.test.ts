import { assertOk } from '@exitbook/foundation/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DataContext } from '../../data-context.js';
import type { KyselyDB } from '../../database.js';
import { seedAccount, seedUser } from '../../repositories/__tests__/helpers.js';
import { computeAccountHash } from '../account-hash.js';
import { createTestDatabase } from '../test-utils.js';

describe('computeAccountHash', () => {
  let db: KyselyDB;
  let ctx: DataContext;

  beforeEach(async () => {
    db = await createTestDatabase();
    ctx = new DataContext(db);
    await seedUser(db);
  });

  afterEach(async () => {
    await db.destroy();
  });

  it('produces a deterministic hash for the same accounts', async () => {
    await seedAccount(db, 1, 'blockchain', 'bitcoin');
    await seedAccount(db, 2, 'exchange-api', 'kraken');

    const hash1 = assertOk(await computeAccountHash(ctx));
    const hash2 = assertOk(await computeAccountHash(ctx));
    expect(hash1).toBe(hash2);
  });

  it('produces a consistent hash for empty accounts', async () => {
    const hash = assertOk(await computeAccountHash(ctx));
    expect(typeof hash).toBe('string');
    expect(hash.length).toBeGreaterThan(0);
  });

  it('changes when an account is added', async () => {
    await seedAccount(db, 1, 'blockchain', 'bitcoin');
    const hash1 = assertOk(await computeAccountHash(ctx));

    await seedAccount(db, 2, 'exchange-api', 'kraken');
    const hash2 = assertOk(await computeAccountHash(ctx));

    expect(hash1).not.toBe(hash2);
  });

  it('changes when an account identifier changes', async () => {
    await seedAccount(db, 1, 'blockchain', 'bitcoin');
    const hash1 = assertOk(await computeAccountHash(ctx));

    await db.updateTable('accounts').set({ identifier: 'different-identifier' }).where('id', '=', 1).execute();

    const hash2 = assertOk(await computeAccountHash(ctx));
    expect(hash1).not.toBe(hash2);
  });
});
