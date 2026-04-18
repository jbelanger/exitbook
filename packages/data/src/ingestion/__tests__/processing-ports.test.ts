/* eslint-disable unicorn/no-null -- raw SQLite insert tests use explicit nulls for nullable columns */
import { ok } from '@exitbook/foundation';
import { assertOk } from '@exitbook/foundation/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DataSession } from '../../data-session.js';
import type { KyselyDB } from '../../database.js';
import { buildProcessingPorts } from '../../ingestion/processing-ports.js';
import { buildProfileProjectionScopeKey } from '../../projections/profile-scope-key.js';
import {
  seedAccount,
  seedImportSession,
  seedTxFingerprint,
  seedProfile,
} from '../../repositories/__tests__/helpers.js';
import { createTestDatabase } from '../../utils/test-utils.js';

describe('buildProcessingPorts', () => {
  let db: KyselyDB;
  let ctx: DataSession;

  beforeEach(async () => {
    db = await createTestDatabase();
    ctx = new DataSession(db);
    await seedProfile(db);
    await seedAccount(db, 1, 'exchange-api', 'kraken');
    await seedImportSession(db, 1, 1);
  });

  afterEach(async () => {
    await db.destroy();
  });

  it('exposes transaction override materialization through processing ports', async () => {
    await db
      .insertInto('transactions')
      .values({
        id: 1,
        account_id: 1,
        platform_key: 'kraken',
        platform_kind: 'exchange',
        tx_fingerprint: seedTxFingerprint('kraken', 1, 'tx-1'),
        transaction_status: 'success',
        transaction_datetime: '2025-01-01T00:00:00.000Z',
        excluded_from_accounting: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .execute();
    await db
      .insertInto('transaction_movements')
      .values({
        transaction_id: 1,
        movement_type: 'inflow',
        movement_fingerprint: 'movement:test-processing-port:1',
        asset_id: 'exchange:kraken:btc',
        asset_symbol: 'BTC',
        movement_role: 'principal',
        movement_role_override: null,
        gross_amount: '1',
        net_amount: '1',
        fee_amount: null,
        fee_scope: null,
        fee_settlement: null,
        price_amount: null,
        price_currency: null,
        price_source: null,
        price_fetched_at: null,
        price_granularity: null,
        fx_rate_to_usd: null,
        fx_source: null,
        fx_timestamp: null,
      })
      .execute();

    const txFingerprint = seedTxFingerprint('kraken', 1, 'tx-1');
    const movementFingerprint = 'movement:test-processing-port:1';
    const overrideEvents = [
      {
        id: 'override-1',
        created_at: '2026-03-15T12:00:00.000Z',
        actor: 'user',
        source: 'cli',
        scope: 'transaction-user-note' as const,
        payload: {
          type: 'transaction_user_note_override' as const,
          action: 'set' as const,
          tx_fingerprint: txFingerprint,
          message: 'Remember this withdrawal',
        },
      },
      {
        id: 'override-2',
        created_at: '2026-03-15T12:01:00.000Z',
        actor: 'user',
        source: 'cli',
        scope: 'transaction-movement-role' as const,
        payload: {
          type: 'transaction_movement_role_override' as const,
          action: 'set' as const,
          movement_fingerprint: movementFingerprint,
          movement_role: 'staking_reward' as const,
        },
      },
    ];

    const overrideStore = {
      exists: vi.fn().mockReturnValue(true),
      readByScopes: vi
        .fn()
        .mockImplementation(async (_profileKey: string, scopes: string[]) =>
          ok(overrideEvents.filter((event) => scopes.includes(event.scope)))
        ),
    };

    const ports = buildProcessingPorts(ctx, {
      rebuildAssetReviewProjection: vi.fn().mockResolvedValue(ok(undefined)),
      overrideStore,
    });

    const updatedCount = assertOk(await ports.transactionOverrides.materializeStoredOverrides({ transactionIds: [1] }));
    expect(updatedCount).toBe(2);

    const transactionRow = await db
      .selectFrom('transactions')
      .select(['user_notes_json'])
      .where('id', '=', 1)
      .executeTakeFirstOrThrow();
    expect(JSON.parse((transactionRow.user_notes_json as string | null) ?? '[]')).toEqual([
      {
        message: 'Remember this withdrawal',
        createdAt: '2026-03-15T12:00:00.000Z',
        author: 'user',
      },
    ]);

    const movementRow = await db
      .selectFrom('transaction_movements')
      .select(['movement_role', 'movement_role_override'])
      .where('movement_fingerprint', '=', movementFingerprint)
      .executeTakeFirstOrThrow();
    expect(movementRow).toMatchObject({
      movement_role: 'principal',
      movement_role_override: 'staking_reward',
    });
  });

  it('threads processed account scope through the asset-review rebuild port', async () => {
    const rebuildAssetReviewProjection = vi.fn().mockResolvedValue(ok(undefined));
    const ports = buildProcessingPorts(ctx, {
      rebuildAssetReviewProjection,
      overrideStore: {
        exists: vi.fn().mockReturnValue(false),
        readByScopes: vi.fn().mockResolvedValue(ok([])),
      },
    });

    assertOk(await ports.rebuildAssetReviewProjection([1]));

    expect(rebuildAssetReviewProjection).toHaveBeenCalledWith([1]);
  });

  it('filters raw-data account discovery by profile', async () => {
    await db
      .insertInto('profiles')
      .values({ id: 2, profile_key: 'secondary', display_name: 'secondary', created_at: new Date().toISOString() })
      .execute();
    await seedAccount(db, 2, 'exchange-api', 'coinbase', { profileId: 2 });

    await db
      .insertInto('raw_transactions')
      .values([
        {
          account_id: 1,
          provider_name: 'test',
          event_id: 'event-profile-1',
          timestamp: Date.now(),
          provider_data: '{}',
          normalized_data: '{}',
          processing_status: 'pending',
          created_at: new Date().toISOString(),
        },
        {
          account_id: 2,
          provider_name: 'test',
          event_id: 'event-profile-2',
          timestamp: Date.now(),
          provider_data: '{}',
          normalized_data: '{}',
          processing_status: 'pending',
          created_at: new Date().toISOString(),
        },
      ])
      .execute();

    const ports = buildProcessingPorts(ctx, {
      rebuildAssetReviewProjection: vi.fn().mockResolvedValue(ok(undefined)),
      overrideStore: {
        exists: vi.fn().mockReturnValue(false),
        readByScopes: vi.fn().mockResolvedValue(ok([])),
      },
    });

    expect(assertOk(await ports.batchSource.findAccountsWithRawData(1))).toEqual([1]);
    expect(assertOk(await ports.batchSource.findAccountsWithRawData(2))).toEqual([2]);
  });

  it('marks processed-transactions state per affected profile', async () => {
    await db
      .insertInto('profiles')
      .values({ id: 2, profile_key: 'secondary', display_name: 'secondary', created_at: new Date().toISOString() })
      .execute();
    await seedAccount(db, 2, 'exchange-api', 'coinbase', { profileId: 2 });

    const ports = buildProcessingPorts(ctx, {
      rebuildAssetReviewProjection: vi.fn().mockResolvedValue(ok(undefined)),
      overrideStore: {
        exists: vi.fn().mockReturnValue(false),
        readByScopes: vi.fn().mockResolvedValue(ok([])),
      },
    });

    assertOk(await ports.markProcessedTransactionsBuilding([1]));
    const profileOneBuilding = assertOk(
      await ctx.projectionState.find('processed-transactions', buildProfileProjectionScopeKey(1))
    );
    expect(profileOneBuilding?.status).toBe('building');
    expect(
      assertOk(await ctx.projectionState.find('processed-transactions', buildProfileProjectionScopeKey(2)))
    ).toBeUndefined();

    assertOk(await ports.markProcessedTransactionsFailed([2]));
    const profileTwoFailed = assertOk(
      await ctx.projectionState.find('processed-transactions', buildProfileProjectionScopeKey(2))
    );
    expect(profileTwoFailed?.status).toBe('failed');
  });
});
