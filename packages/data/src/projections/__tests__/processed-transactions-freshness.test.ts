/* eslint-disable unicorn/no-null -- DB column values require null */
import { assertOk } from '@exitbook/foundation/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DataSession } from '../../data-session.js';
import type { KyselyDB } from '../../database.js';
import { buildProcessedTransactionsFreshnessPorts } from '../../projections/processed-transactions-freshness.js';
import { seedProfile, seedAccount, seedImportSession } from '../../repositories/__tests__/helpers.js';
import { ProjectionStateRepository } from '../../repositories/projection-state-repository.js';
import { createTestDatabase } from '../../utils/test-utils.js';

describe('buildProcessedTransactionsFreshnessPorts', () => {
  let db: KyselyDB;
  let ctx: DataSession;

  beforeEach(async () => {
    db = await createTestDatabase();
    ctx = new DataSession(db);
  });

  afterEach(async () => {
    await db.destroy();
  });

  async function seedRawTransaction(accountId: number) {
    await db
      .insertInto('raw_transactions')
      .values({
        account_id: accountId,
        provider_name: 'test',
        event_id: `event-${globalThis.crypto.randomUUID()}`,
        timestamp: Date.now(),
        provider_data: '{}',
        normalized_data: '{}',
        processing_status: 'pending',
        created_at: new Date().toISOString(),
      })
      .execute();
  }

  it('returns fresh when no raw data exists', async () => {
    const freshness = buildProcessedTransactionsFreshnessPorts(ctx);
    const result = assertOk(await freshness.checkFreshness());
    expect(result.status).toBe('fresh');
    expect(result.reason).toBeUndefined();
  });

  it('returns stale when raw data exists but never processed', async () => {
    await seedProfile(db);
    await seedAccount(db, 1, 'blockchain', 'bitcoin');
    await seedRawTransaction(1);

    const freshness = buildProcessedTransactionsFreshnessPorts(ctx);
    const result = assertOk(await freshness.checkFreshness());
    expect(result.status).toBe('stale');
    expect(result.reason).toBe('raw data has never been processed');
  });

  it('returns fresh when projection is marked fresh with matching account hash', async () => {
    await seedProfile(db);
    await seedAccount(db, 1, 'blockchain', 'bitcoin');
    await seedRawTransaction(1);

    // Compute the account hash the adapter will use
    const accounts = assertOk(await ctx.accounts.findAll());
    const sorted = accounts.map((a) => `${a.id}:${a.identifier}`).sort();
    const raw = sorted.join('|');
    let hash = 0;
    for (let i = 0; i < raw.length; i++) {
      const char = raw.charCodeAt(i);
      hash = ((hash << 5) - hash + char) | 0;
    }
    const expectedHash = hash.toString(36);

    // Mark fresh with correct hash and a recent build time
    const repo = new ProjectionStateRepository(db);
    assertOk(await repo.markFresh('processed-transactions', { accountHash: expectedHash }));

    const freshness = buildProcessedTransactionsFreshnessPorts(ctx);
    const result = assertOk(await freshness.checkFreshness());
    expect(result.status).toBe('fresh');
  });

  it('returns stale when account hash has changed', async () => {
    await seedProfile(db);
    await seedAccount(db, 1, 'blockchain', 'bitcoin');
    await seedRawTransaction(1);

    const repo = new ProjectionStateRepository(db);
    assertOk(await repo.markFresh('processed-transactions', { accountHash: 'old-hash' }));

    const freshness = buildProcessedTransactionsFreshnessPorts(ctx);
    const result = assertOk(await freshness.checkFreshness());
    expect(result.status).toBe('stale');
    expect(result.reason).toBe('account graph changed');
  });

  it('returns stale when projection state is explicitly stale', async () => {
    await seedProfile(db);
    await seedAccount(db, 1, 'blockchain', 'bitcoin');
    await seedRawTransaction(1);

    const repo = new ProjectionStateRepository(db);
    assertOk(await repo.markStale('processed-transactions', 'import-completed'));

    const freshness = buildProcessedTransactionsFreshnessPorts(ctx);
    const result = assertOk(await freshness.checkFreshness());
    expect(result.status).toBe('stale');
    expect(result.reason).toBe('import-completed');
  });

  it('returns stale when a new import completed after last build', async () => {
    await seedProfile(db);
    await seedAccount(db, 1, 'blockchain', 'bitcoin');
    await seedRawTransaction(1);

    // Compute hash
    const accounts = assertOk(await ctx.accounts.findAll());
    const sorted = accounts.map((a) => `${a.id}:${a.identifier}`).sort();
    const raw = sorted.join('|');
    let hash = 0;
    for (let i = 0; i < raw.length; i++) {
      const char = raw.charCodeAt(i);
      hash = ((hash << 5) - hash + char) | 0;
    }
    const expectedHash = hash.toString(36);

    // Mark fresh with old build time
    const repo = new ProjectionStateRepository(db);
    assertOk(
      await repo.upsert({
        projectionId: 'processed-transactions',
        scopeKey: '__global__',
        status: 'fresh',
        lastBuiltAt: new Date('2025-01-01T00:00:00.000Z'),
        lastInvalidatedAt: null,
        invalidatedBy: null,
        metadata: { accountHash: expectedHash },
      })
    );

    // Create an import session completed after the build
    await seedImportSession(db, 1, 1);
    await db
      .updateTable('import_sessions')
      .set({ completed_at: new Date('2026-01-01T00:00:00.000Z').toISOString() })
      .where('id', '=', 1)
      .execute();

    const freshness = buildProcessedTransactionsFreshnessPorts(ctx);
    const result = assertOk(await freshness.checkFreshness());
    expect(result.status).toBe('stale');
    expect(result.reason).toBe('new import completed since last build');
  });
});
