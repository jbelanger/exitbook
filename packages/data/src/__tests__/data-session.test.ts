import { ok, err, type Result } from '@exitbook/foundation';
import { assertOk, assertErr } from '@exitbook/foundation/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DataSession } from '../data-session.js';
import type { KyselyDB } from '../database.js';
import { seedProfile } from '../repositories/__tests__/helpers.js';
import { createTestDatabase } from '../utils/test-utils.js';

describe('DataSession', () => {
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

  it('exposes all repositories', () => {
    expect(ctx.accounts).toBeDefined();
    expect(ctx.assetReview).toBeDefined();
    expect(ctx.transactions).toBeDefined();
    expect(ctx.transactionLinks).toBeDefined();
    expect(ctx.rawTransactions).toBeDefined();
    expect(ctx.importSessions).toBeDefined();
    expect(ctx.profiles).toBeDefined();
    expect(ctx.nearRawTransactions).toBeDefined();
    expect(ctx.projectionState).toBeDefined();
  });

  describe('executeInTransaction', () => {
    it('commits on ok result', async () => {
      const result = assertOk(
        await ctx.executeInTransaction(async (tx) => {
          assertOk(
            await tx.accounts.findOrCreate({
              profileId: 1,
              accountType: 'blockchain',
              platformKey: 'bitcoin',
              identifier: 'bc1q-test',
            })
          );
          return ok('done');
        })
      );

      expect(result).toBe('done');

      // Verify account persisted outside the transaction
      const accounts = assertOk(await ctx.accounts.findAll());
      expect(accounts).toHaveLength(1);
      expect(accounts[0]!.identifier).toBe('bc1q-test');
    });

    it('rolls back on err result', async () => {
      const result = await ctx.executeInTransaction(async (tx) => {
        assertOk(
          await tx.accounts.findOrCreate({
            profileId: 1,
            accountType: 'blockchain',
            platformKey: 'bitcoin',
            identifier: 'bc1q-rollback',
          })
        );
        return err(new Error('intentional failure'));
      });

      expect(result.isErr()).toBe(true);
      assertErr(result);

      // Verify account was NOT persisted
      const accounts = assertOk(await ctx.accounts.findAll());
      expect(accounts).toHaveLength(0);
    });

    it('rolls back on thrown exception', async () => {
      const result = await ctx.executeInTransaction(async (tx) => {
        assertOk(
          await tx.accounts.findOrCreate({
            profileId: 1,
            accountType: 'blockchain',
            platformKey: 'bitcoin',
            identifier: 'bc1q-throw',
          })
        );
        throw new Error('unexpected throw');
      });

      expect(result.isErr()).toBe(true);

      const accounts = assertOk(await ctx.accounts.findAll());
      expect(accounts).toHaveLength(0);
    });

    it('nests transparently — inner executeInTransaction reuses outer transaction', async () => {
      const result = assertOk(
        await ctx.executeInTransaction(async (outerTx) => {
          // Create account in outer transaction
          assertOk(
            await outerTx.accounts.findOrCreate({
              profileId: 1,
              accountType: 'blockchain',
              platformKey: 'bitcoin',
              identifier: 'bc1q-outer',
            })
          );

          // Nested transaction should reuse the outer one
          const innerResult = assertOk(
            await outerTx.executeInTransaction(async (innerTx) => {
              assertOk(
                await innerTx.accounts.findOrCreate({
                  profileId: 1,
                  accountType: 'exchange-api',
                  platformKey: 'kraken',
                  identifier: 'api-key-inner',
                })
              );
              return ok('inner-done');
            })
          );

          expect(innerResult).toBe('inner-done');
          return ok('outer-done');
        })
      );

      expect(result).toBe('outer-done');

      // Both accounts should be committed
      const accounts = assertOk(await ctx.accounts.findAll());
      expect(accounts).toHaveLength(2);
    });

    it('inner err in nested transaction propagates to outer', async () => {
      const result = await ctx.executeInTransaction(async (outerTx) => {
        assertOk(
          await outerTx.accounts.findOrCreate({
            profileId: 1,
            accountType: 'blockchain',
            platformKey: 'bitcoin',
            identifier: 'bc1q-nested-fail',
          })
        );

        const innerResult = await outerTx.executeInTransaction(async () => {
          return err(new Error('inner failure'));
        });

        // Propagate inner failure
        if (innerResult.isErr()) return innerResult as Result<string, Error>;
        return ok('should not reach');
      });

      expect(result.isErr()).toBe(true);

      // Outer should have rolled back — no account persisted
      const accounts = assertOk(await ctx.accounts.findAll());
      expect(accounts).toHaveLength(0);
    });
  });

  describe('close', () => {
    it('closes the database connection', async () => {
      const result = await ctx.close();
      expect(result.isOk()).toBe(true);
    });
  });
});
