import { assertOk } from '@exitbook/foundation/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DataSession } from '../../data-session.js';
import type { KyselyDB } from '../../database.js';
import { buildLinksResetPorts } from '../../projections/links-reset.js';
import { buildProfileProjectionScopeKey } from '../../projections/profile-scope-key.js';
import { seedAccount, seedTxFingerprint, seedProfile } from '../../repositories/__tests__/helpers.js';
import { createTestDatabase } from '../../utils/test-utils.js';

describe('buildLinksResetPorts', () => {
  let db: KyselyDB;
  let ctx: DataSession;

  beforeEach(async () => {
    db = await createTestDatabase();
    ctx = new DataSession(db);
    await seedProfile(db);
    await seedAccount(db, 1, 'exchange-api', 'kraken');
    await seedAccount(db, 2, 'exchange-api', 'coinbase');
  });

  afterEach(async () => {
    await db.destroy();
  });

  async function seedTransactionPair() {
    const tx1Fingerprint = 'test-tx-1';
    const tx1 = await db
      .insertInto('transactions')
      .values({
        account_id: 1,
        platform_key: 'test',
        platform_kind: 'exchange',
        tx_fingerprint: seedTxFingerprint('test', 1, tx1Fingerprint),
        transaction_status: 'success',
        transaction_datetime: '2025-01-01T00:00:00.000Z',
        is_spam: false,
        excluded_from_accounting: false,
        created_at: new Date().toISOString(),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    const tx2Fingerprint = 'test-tx-2';
    const tx2 = await db
      .insertInto('transactions')
      .values({
        account_id: 2,
        platform_key: 'test',
        platform_kind: 'exchange',
        tx_fingerprint: seedTxFingerprint('test', 2, tx2Fingerprint),
        transaction_status: 'success',
        transaction_datetime: '2025-01-01T00:00:00.000Z',
        is_spam: false,
        excluded_from_accounting: false,
        created_at: new Date().toISOString(),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return { tx1Id: tx1.id, tx2Id: tx2.id };
  }

  async function seedLink(fromTxId: number, toTxId: number) {
    const now = new Date().toISOString();
    await db
      .insertInto('transaction_links')
      .values({
        source_transaction_id: fromTxId,
        target_transaction_id: toTxId,
        asset: 'BTC',
        source_asset_id: 'exchange:kraken:btc',
        target_asset_id: 'blockchain:bitcoin:native',
        source_amount: '1.0',
        target_amount: '1.0',
        source_movement_fingerprint: `movement:exchange:kraken:${fromTxId}:outflow:0`,
        target_movement_fingerprint: `movement:blockchain:bitcoin:${toTxId}:inflow:0`,
        link_type: 'exchange_to_blockchain',
        confidence_score: '1.0',
        match_criteria_json: JSON.stringify({
          assetMatch: true,
          timingValid: true,
          timingHours: 1,
          amountSimilarity: 0.95,
        }),
        status: 'confirmed',
        created_at: now,
        updated_at: now,
      })
      .execute();
  }

  it('counts links impact', async () => {
    const { tx1Id, tx2Id } = await seedTransactionPair();
    await seedLink(tx1Id, tx2Id);

    const reset = buildLinksResetPorts(ctx);
    const impact = assertOk(await reset.countResetImpact());
    expect(impact.links).toBe(1);
  });

  it('deletes all links on reset', async () => {
    const { tx1Id, tx2Id } = await seedTransactionPair();
    await seedLink(tx1Id, tx2Id);

    const reset = buildLinksResetPorts(ctx);
    const impact = assertOk(await reset.reset());
    expect(impact.links).toBe(1);

    const remaining = assertOk(await ctx.transactionLinks.count());
    expect(remaining).toBe(0);

    const linksState = assertOk(await ctx.projectionState.get('links', buildProfileProjectionScopeKey(1)));
    expect(linksState!.status).toBe('stale');
    expect(linksState!.invalidatedBy).toBe('reset');
    expect(assertOk(await ctx.projectionState.get('links'))).toBeUndefined();
  });

  it('scopes reset to specific account IDs', async () => {
    const { tx1Id, tx2Id } = await seedTransactionPair();
    await seedLink(tx1Id, tx2Id);

    const reset = buildLinksResetPorts(ctx);
    const impact = assertOk(await reset.reset([1]));
    expect(impact.links).toBe(1);
  });
});
