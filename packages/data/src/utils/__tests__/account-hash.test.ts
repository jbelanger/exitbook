import { assertOk } from '@exitbook/foundation/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DataSession } from '../../data-session.js';
import type { KyselyDB } from '../../database.js';
import { computeTestAccountFingerprint, seedAccount, seedProfile } from '../../repositories/__tests__/helpers.js';
import { computeAccountHash, computeScopedAccountHash } from '../account-hash.js';
import { createTestDatabase } from '../test-utils.js';

describe('computeAccountHash', () => {
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

    await db
      .updateTable('accounts')
      .set({
        identifier: 'different-identifier',
        account_fingerprint: await computeTestAccountFingerprint(db, {
          profileId: 1,
          accountType: 'blockchain',
          platformKey: 'bitcoin',
          identifier: 'different-identifier',
        }),
      })
      .where('id', '=', 1)
      .execute();

    const hash2 = assertOk(await computeAccountHash(ctx));
    expect(hash1).not.toBe(hash2);
  });

  it('only changes the scoped hash for the affected profile', async () => {
    await db
      .insertInto('profiles')
      .values({
        id: 2,
        profile_key: 'business',
        display_name: 'Business',
        created_at: new Date().toISOString(),
      })
      .execute();
    await seedAccount(db, 1, 'blockchain', 'bitcoin', { profileId: 1 });
    await seedAccount(db, 2, 'exchange-api', 'kraken', { profileId: 2 });

    const defaultHash1 = assertOk(await computeScopedAccountHash(ctx, 1));
    const businessHash1 = assertOk(await computeScopedAccountHash(ctx, 2));

    await db
      .updateTable('accounts')
      .set({
        identifier: 'different-business-identifier',
        account_fingerprint: await computeTestAccountFingerprint(db, {
          profileId: 2,
          accountType: 'exchange-api',
          platformKey: 'kraken',
          identifier: 'different-business-identifier',
        }),
      })
      .where('id', '=', 2)
      .execute();

    const defaultHash2 = assertOk(await computeScopedAccountHash(ctx, 1));
    const businessHash2 = assertOk(await computeScopedAccountHash(ctx, 2));

    expect(defaultHash2).toBe(defaultHash1);
    expect(businessHash2).not.toBe(businessHash1);
  });
});
