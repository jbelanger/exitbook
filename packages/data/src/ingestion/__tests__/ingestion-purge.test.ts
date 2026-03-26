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

      const ports = buildIngestionPurgePorts(ctx);
      const impact = assertOk(await ports.purgeImportedData(undefined));

      expect(impact.sessions).toBe(1);

      // Import sessions should be deleted (accounts remain when no IDs specified per the logic)
      const sessions = assertOk(await ctx.importSessions.findAll());
      expect(sessions).toHaveLength(0);
    });
  });
});
