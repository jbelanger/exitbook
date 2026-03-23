import { ok } from '@exitbook/foundation';
import { assertOk } from '@exitbook/foundation/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DataContext } from '../../data-context.js';
import type { KyselyDB } from '../../database.js';
import { seedAccount, seedUser } from '../../repositories/__tests__/helpers.js';
import { ProjectionStateRepository } from '../../repositories/projection-state-repository.js';
import { createTestDatabase } from '../../utils/test-utils.js';
import { buildImportPorts } from '../import-ports-adapter.js';

describe('buildImportPorts', () => {
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

  describe('importSessions.update', () => {
    it('strips undefined values before forwarding to repo', async () => {
      await seedAccount(db, 1, 'exchange-api', 'kraken');
      const ports = buildImportPorts(ctx);
      const sessionId = assertOk(await ports.importSessions.create(1));

      // Update with some undefined values — should not fail
      const result = await ports.importSessions.update(sessionId, {
        status: 'completed',
        error_message: undefined,
      });
      expect(result.isOk()).toBe(true);
    });
  });

  describe('invalidateProjections', () => {
    it('marks processed-transactions stale and cascades to downstream projections', async () => {
      await seedAccount(db, 1, 'blockchain', 'bitcoin');
      const ports = buildImportPorts(ctx);

      assertOk(await ports.invalidateProjections([1], 'new-import'));

      const repo = new ProjectionStateRepository(db);
      const ptState = assertOk(await repo.get('processed-transactions'));
      expect(ptState?.status).toBe('stale');
      expect(ptState?.invalidatedBy).toBe('new-import');

      // Downstream projections should also be stale
      const assetReviewState = assertOk(await repo.get('asset-review'));
      expect(assetReviewState?.status).toBe('stale');
      const linksState = assertOk(await repo.get('links'));
      expect(linksState?.status).toBe('stale');

      const balancesState = assertOk(await repo.get('balances', 'balance:1'));
      expect(balancesState?.status).toBe('stale');
      expect(balancesState?.invalidatedBy).toBe('upstream-import:processed-transactions');
    });

    it('marks the root balance scope stale when importing a child account', async () => {
      await seedAccount(db, 1, 'blockchain', 'bitcoin');
      await seedAccount(db, 2, 'blockchain', 'bitcoin', { parentAccountId: 1 });

      const ports = buildImportPorts(ctx);
      assertOk(await ports.invalidateProjections([2], 'new-import'));

      const repo = new ProjectionStateRepository(db);
      const parentScopeState = assertOk(await repo.get('balances', 'balance:1'));
      expect(parentScopeState?.status).toBe('stale');
      expect(parentScopeState?.invalidatedBy).toBe('upstream-import:processed-transactions');

      const childScopeState = assertOk(await repo.get('balances', 'balance:2'));
      expect(childScopeState).toBeUndefined();
    });
  });

  describe('withTransaction', () => {
    it('executes callback in a transaction', async () => {
      const ports = buildImportPorts(ctx);

      const result = await ports.withTransaction(async (txPorts) => {
        const user = assertOk(await txPorts.users.findOrCreateDefault());
        expect(user.id).toBe(1);
        return ok(undefined);
      });

      expect(result.isOk()).toBe(true);
    });
  });
});
