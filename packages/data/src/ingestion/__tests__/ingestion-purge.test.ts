/* eslint-disable unicorn/no-null -- acceptable in tests */
import type { CursorState } from '@exitbook/foundation';
import { assertOk } from '@exitbook/foundation/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DataSession } from '../../data-session.js';
import type { KyselyDB } from '../../database.js';
import { buildIngestionPurgePorts } from '../../ingestion/ingestion-purge.js';
import { seedAccount, seedImportSession, seedProfile } from '../../repositories/__tests__/helpers.js';
import { createTestDatabase } from '../../utils/test-utils.js';

describe('buildIngestionPurgePorts', () => {
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

  describe('countPurgeImpact', () => {
    it('counts impact for specific account IDs', async () => {
      await seedAccount(db, 1, 'exchange-api', 'kraken');
      await seedAccount(db, 2, 'blockchain', 'bitcoin');
      await seedImportSession(db, 1, 1);
      await seedImportSession(db, 2, 1);
      await seedImportSession(db, 3, 2);

      const ports = buildIngestionPurgePorts(ctx);
      const impact = assertOk(await ports.countPurgeImpact([1]));

      expect(impact.accounts).toBe(1);
      expect(impact.sessions).toBe(2);
      expect(impact.rawData).toBe(0);
    });

    it('counts impact for all accounts when no IDs provided', async () => {
      await seedAccount(db, 1, 'exchange-api', 'kraken');
      await seedImportSession(db, 1, 1);

      const ports = buildIngestionPurgePorts(ctx);
      const impact = assertOk(await ports.countPurgeImpact(undefined));

      expect(impact.accounts).toBe(0); // accountIds is undefined, so accounts count is 0
      expect(impact.sessions).toBe(1);
    });
  });

  describe('purgeImportedData', () => {
    it('purges data for specific accounts', async () => {
      await seedAccount(db, 1, 'exchange-api', 'kraken');
      await seedAccount(db, 2, 'blockchain', 'bitcoin');
      await seedImportSession(db, 1, 1);
      await seedImportSession(db, 2, 2);

      const ports = buildIngestionPurgePorts(ctx);
      const impact = assertOk(await ports.purgeImportedData([1]));

      expect(impact.accounts).toBe(1);
      expect(impact.sessions).toBe(1);

      // Account 1 should be deleted, account 2 remains
      const remaining = assertOk(await ctx.accounts.findAll());
      expect(remaining).toHaveLength(1);
      expect(remaining[0]!.id).toBe(2);
    });

    it('purges all import data when no IDs provided', async () => {
      await seedAccount(db, 1, 'exchange-api', 'kraken');
      await seedImportSession(db, 1, 1);
      await seedRawTransaction(db, 1);
      await ctx.accounts.updateCursor(1, 'normal', testCursor());

      const ports = buildIngestionPurgePorts(ctx);
      const impact = assertOk(await ports.purgeImportedData(undefined));

      expect(impact.sessions).toBe(1);
      expect(impact.rawData).toBe(1);

      // Import sessions and raw data should be deleted; accounts remain but resume cursors are invalidated.
      const sessions = assertOk(await ctx.importSessions.findAll());
      const rawData = assertOk(await ctx.rawTransactions.findAll());
      const accounts = assertOk(await ctx.accounts.findAll());
      expect(sessions).toHaveLength(0);
      expect(rawData).toHaveLength(0);
      expect(accounts).toHaveLength(1);
      expect(accounts[0]!.lastCursor).toBeUndefined();
    });
  });
});

function testCursor(): CursorState {
  return {
    primary: { type: 'blockNumber', value: 18_000_000 },
    lastTransactionId: 'tx-stale',
    totalFetched: 73_857,
  };
}

async function seedRawTransaction(db: KyselyDB, accountId: number): Promise<void> {
  await db
    .insertInto('raw_transactions')
    .values({
      account_id: accountId,
      provider_name: 'ethereum',
      event_id: 'raw-stale',
      blockchain_transaction_hash: null,
      source_address: null,
      transaction_type_hint: null,
      provider_data: JSON.stringify({ id: 'raw-stale' }),
      normalized_data: '{}',
      processing_status: 'pending',
      processed_at: null,
      created_at: new Date().toISOString(),
      timestamp: Date.now(),
    })
    .execute();
}
