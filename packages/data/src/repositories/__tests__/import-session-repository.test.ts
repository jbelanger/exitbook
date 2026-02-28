/* eslint-disable unicorn/no-null -- null required by db */
import { createTestDatabase } from '@exitbook/data';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { KyselyDB } from '../../storage/initialization.js';
import { ImportSessionRepository } from '../import-session-repository.js';

import { seedAccount, seedUser } from './helpers.js';

interface InsertSessionInput {
  accountId: number;
  status?: 'started' | 'completed' | 'failed' | 'cancelled' | undefined;
  startedAt?: string | undefined;
  completedAt?: string | null | undefined;
  durationMs?: number | null | undefined;
  transactionsImported?: number | undefined;
  transactionsSkipped?: number | undefined;
  errorMessage?: string | null | undefined;
  errorDetails?: unknown;
  createdAt?: string | undefined;
  updatedAt?: string | null | undefined;
}

async function seedDatabase(db: KyselyDB): Promise<void> {
  await seedUser(db);
  await seedAccount(db, 1, 'exchange-api', 'kraken');
  await seedAccount(db, 2, 'blockchain', 'ethereum');
}

async function insertSession(db: KyselyDB, input: InsertSessionInput): Promise<number> {
  const result = await db
    .insertInto('import_sessions')
    .values({
      account_id: input.accountId,
      status: input.status ?? 'started',
      started_at: input.startedAt ?? new Date().toISOString(),
      completed_at: input.completedAt ?? null,
      duration_ms: input.durationMs ?? null,
      transactions_imported: input.transactionsImported ?? 0,
      transactions_skipped: input.transactionsSkipped ?? 0,
      error_message: input.errorMessage ?? null,
      error_details: input.errorDetails === undefined ? null : JSON.stringify(input.errorDetails),
      created_at: input.createdAt ?? new Date().toISOString(),
      updated_at: input.updatedAt ?? null,
    })
    .returning('id')
    .executeTakeFirstOrThrow();

  return result.id;
}

describe('ImportSessionRepository', () => {
  let db: KyselyDB;
  let repo: ImportSessionRepository;

  beforeEach(async () => {
    db = await createTestDatabase();
    repo = new ImportSessionRepository(db);
    await seedDatabase(db);
  });

  afterEach(async () => {
    await db.destroy();
  });

  describe('create', () => {
    it('creates a started import session and returns its ID', async () => {
      const result = await repo.create(1);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBeGreaterThan(0);

        const row = await db
          .selectFrom('import_sessions')
          .selectAll()
          .where('id', '=', result.value)
          .executeTakeFirst();
        expect(row).toBeDefined();
        expect(row?.account_id).toBe(1);
        expect(row?.status).toBe('started');
        expect(row?.transactions_imported).toBe(0);
        expect(row?.transactions_skipped).toBe(0);
        expect(row?.started_at).toBeDefined();
        expect(row?.created_at).toBeDefined();
      }
    });

    it('returns an error when the database is closed', async () => {
      await db.destroy();

      const result = await repo.create(1);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message.length).toBeGreaterThan(0);
      }
    });
  });

  describe('finalize', () => {
    it('marks a session complete with duration, counts, and error metadata', async () => {
      const createResult = await repo.create(1);
      expect(createResult.isOk()).toBe(true);

      if (createResult.isOk()) {
        const startTime = Date.now() - 250;
        const finalizeResult = await repo.finalize(createResult.value, 'failed', startTime, 12, 3, 'Provider timeout', {
          code: 'TIMEOUT',
          attempt: 2,
        });

        expect(finalizeResult.isOk()).toBe(true);

        const row = await db
          .selectFrom('import_sessions')
          .selectAll()
          .where('id', '=', createResult.value)
          .executeTakeFirstOrThrow();

        expect(row.status).toBe('failed');
        expect(row.transactions_imported).toBe(12);
        expect(row.transactions_skipped).toBe(3);
        expect(row.error_message).toBe('Provider timeout');
        expect(row.error_details).toBe(JSON.stringify({ code: 'TIMEOUT', attempt: 2 }));
        expect(row.completed_at).toBeDefined();
        expect(row.updated_at).toBeDefined();
        expect((row.duration_ms ?? 0) > 0).toBe(true);
      }
    });

    it('returns an error when error details cannot be serialized', async () => {
      const createResult = await repo.create(1);
      expect(createResult.isOk()).toBe(true);

      if (createResult.isOk()) {
        const circular: Record<string, unknown> = {};
        circular['self'] = circular;

        const finalizeResult = await repo.finalize(
          createResult.value,
          'failed',
          Date.now(),
          0,
          0,
          'bad payload',
          circular
        );

        expect(finalizeResult.isErr()).toBe(true);
        if (finalizeResult.isErr()) {
          expect(finalizeResult.error.message).toContain('Failed to serialize JSON');
        }

        const row = await db
          .selectFrom('import_sessions')
          .selectAll()
          .where('id', '=', createResult.value)
          .executeTakeFirstOrThrow();
        expect(row.status).toBe('started');
      }
    });

    it('returns an error when the database is closed', async () => {
      const createResult = await repo.create(1);
      expect(createResult.isOk()).toBe(true);

      if (createResult.isOk()) {
        await db.destroy();

        const result = await repo.finalize(createResult.value, 'completed', Date.now(), 2, 0);

        expect(result.isErr()).toBe(true);
        if (result.isErr()) {
          expect(result.error.message.length).toBeGreaterThan(0);
        }
      }
    });
  });

  describe('findById', () => {
    it('returns a mapped import session when it exists', async () => {
      const startedAt = '2024-01-01T10:00:00.000Z';
      const completedAt = '2024-01-01T10:01:00.000Z';
      const createdAt = '2024-01-01T09:59:50.000Z';
      const updatedAt = '2024-01-01T10:01:10.000Z';
      const sessionId = await insertSession(db, {
        accountId: 1,
        status: 'completed',
        startedAt,
        completedAt,
        durationMs: 60_000,
        transactionsImported: 10,
        transactionsSkipped: 1,
        errorMessage: null,
        errorDetails: { source: 'kraken' },
        createdAt,
        updatedAt,
      });

      const result = await repo.findById(sessionId);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBeDefined();
        expect(result.value?.id).toBe(sessionId);
        expect(result.value?.accountId).toBe(1);
        expect(result.value?.status).toBe('completed');
        expect(result.value?.startedAt.toISOString()).toBe(startedAt);
        expect(result.value?.completedAt?.toISOString()).toBe(completedAt);
        expect(result.value?.durationMs).toBe(60_000);
        expect(result.value?.transactionsImported).toBe(10);
        expect(result.value?.transactionsSkipped).toBe(1);
        expect(result.value?.errorMessage).toBeUndefined();
        expect(result.value?.errorDetails).toEqual({ source: 'kraken' });
        expect(result.value?.createdAt.toISOString()).toBe(createdAt);
        expect(result.value?.updatedAt?.toISOString()).toBe(updatedAt);
      }
    });

    it('returns undefined when no session exists', async () => {
      const result = await repo.findById(999);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBeUndefined();
      }
    });

    it('returns an error when the database is closed', async () => {
      await db.destroy();

      const result = await repo.findById(1);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message.length).toBeGreaterThan(0);
      }
    });
  });

  describe('findAll', () => {
    beforeEach(async () => {
      await insertSession(db, { accountId: 1, status: 'started', startedAt: '2024-01-01T10:00:00.000Z' });
      await insertSession(db, { accountId: 2, status: 'failed', startedAt: '2024-01-01T12:00:00.000Z' });
      await insertSession(db, { accountId: 1, status: 'completed', startedAt: '2024-01-01T11:00:00.000Z' });
    });

    it('returns all sessions ordered by startedAt descending', async () => {
      const result = await repo.findAll();

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toHaveLength(3);
        expect(result.value.map((session) => session.startedAt.toISOString())).toEqual([
          '2024-01-01T12:00:00.000Z',
          '2024-01-01T11:00:00.000Z',
          '2024-01-01T10:00:00.000Z',
        ]);
      }
    });

    it('filters sessions by account IDs', async () => {
      const result = await repo.findAll({ accountIds: [1] });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toHaveLength(2);
        expect(result.value.every((session) => session.accountId === 1)).toBe(true);
      }
    });

    it('returns an empty array when accountIds filter is empty', async () => {
      const result = await repo.findAll({ accountIds: [] });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toEqual([]);
      }
    });

    it('returns an error when the database is closed', async () => {
      await db.destroy();

      const result = await repo.findAll();

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message.length).toBeGreaterThan(0);
      }
    });
  });

  describe('getSessionCountsByAccount', () => {
    beforeEach(async () => {
      await insertSession(db, { accountId: 1 });
      await insertSession(db, { accountId: 1 });
      await insertSession(db, { accountId: 2 });
    });

    it('returns counts for all requested accounts and fills missing with 0', async () => {
      const result = await repo.getSessionCountsByAccount([1, 2, 999]);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.get(1)).toBe(2);
        expect(result.value.get(2)).toBe(1);
        expect(result.value.get(999)).toBe(0);
      }
    });

    it('returns an empty map for empty account list', async () => {
      const result = await repo.getSessionCountsByAccount([]);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.size).toBe(0);
      }
    });

    it('returns an error when the database is closed', async () => {
      await db.destroy();

      const result = await repo.getSessionCountsByAccount([1, 2]);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message.length).toBeGreaterThan(0);
      }
    });
  });

  describe('update', () => {
    it('updates status, counters, and error fields', async () => {
      const sessionId = await insertSession(db, {
        accountId: 1,
        status: 'started',
        updatedAt: null,
        completedAt: null,
      });

      const result = await repo.update(sessionId, {
        status: 'completed',
        transactions_imported: 25,
        transactions_skipped: 5,
        error_message: 'warnings',
        // Repository currently accepts Updateable<ImportSessionsTable> (DB-shaped),
        // but runtime logic serializes arbitrary payloads.
        error_details: { warningCount: 2 } as unknown as string,
      });

      expect(result.isOk()).toBe(true);

      const row = await db
        .selectFrom('import_sessions')
        .selectAll()
        .where('id', '=', sessionId)
        .executeTakeFirstOrThrow();
      expect(row.status).toBe('completed');
      expect(row.transactions_imported).toBe(25);
      expect(row.transactions_skipped).toBe(5);
      expect(row.error_message).toBe('warnings');
      expect(row.error_details).toBe(JSON.stringify({ warningCount: 2 }));
      expect(row.completed_at).toBeDefined();
      expect(row.updated_at).toBeDefined();
    });

    it('does not update timestamps when no changes are provided', async () => {
      const sessionId = await insertSession(db, { accountId: 1, updatedAt: null });

      const result = await repo.update(sessionId, {});

      expect(result.isOk()).toBe(true);

      const row = await db
        .selectFrom('import_sessions')
        .selectAll()
        .where('id', '=', sessionId)
        .executeTakeFirstOrThrow();
      expect(row.updated_at).toBeNull();
    });

    it('does not set completedAt when status remains started', async () => {
      const sessionId = await insertSession(db, { accountId: 1, status: 'started', completedAt: null });

      const result = await repo.update(sessionId, { status: 'started' });

      expect(result.isOk()).toBe(true);

      const row = await db
        .selectFrom('import_sessions')
        .selectAll()
        .where('id', '=', sessionId)
        .executeTakeFirstOrThrow();
      expect(row.status).toBe('started');
      expect(row.completed_at).toBeNull();
      expect(row.updated_at).toBeDefined();
    });

    it('returns an error when error details cannot be serialized', async () => {
      const sessionId = await insertSession(db, { accountId: 1, status: 'started' });
      const circular: Record<string, unknown> = {};
      circular['self'] = circular;

      const result = await repo.update(sessionId, { error_details: circular as unknown as string });

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Failed to serialize JSON');
      }

      const row = await db
        .selectFrom('import_sessions')
        .selectAll()
        .where('id', '=', sessionId)
        .executeTakeFirstOrThrow();
      expect(row.updated_at).toBeNull();
      expect(row.error_details).toBeNull();
    });

    it('returns an error when the database is closed', async () => {
      const sessionId = await insertSession(db, { accountId: 1 });
      await db.destroy();

      const result = await repo.update(sessionId, { status: 'failed' });

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message.length).toBeGreaterThan(0);
      }
    });
  });

  describe('count', () => {
    beforeEach(async () => {
      await insertSession(db, { accountId: 1 });
      await insertSession(db, { accountId: 1 });
      await insertSession(db, { accountId: 2 });
    });

    it('counts all sessions when no filter is provided', async () => {
      const result = await repo.count();

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(3);
      }
    });

    it('counts sessions filtered by account IDs', async () => {
      const result = await repo.count({ accountIds: [1] });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(2);
      }
    });

    it('returns 0 when accountIds filter is empty', async () => {
      const result = await repo.count({ accountIds: [] });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(0);
      }
    });

    it('returns an error when the database is closed', async () => {
      await db.destroy();

      const result = await repo.count();

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message.length).toBeGreaterThan(0);
      }
    });
  });

  describe('deleteBy', () => {
    beforeEach(async () => {
      await insertSession(db, { accountId: 1 });
      await insertSession(db, { accountId: 1 });
      await insertSession(db, { accountId: 2 });
    });

    it('deletes sessions for a specific account', async () => {
      const result = await repo.deleteBy({ accountId: 1 });

      expect(result.isOk()).toBe(true);

      const rows = await db.selectFrom('import_sessions').selectAll().execute();
      expect(rows).toHaveLength(1);
      expect(rows[0]?.account_id).toBe(2);
    });

    it('deletes all sessions when no filter is provided', async () => {
      const result = await repo.deleteBy();

      expect(result.isOk()).toBe(true);

      const rows = await db.selectFrom('import_sessions').selectAll().execute();
      expect(rows).toHaveLength(0);
    });

    it('returns an error when the database is closed', async () => {
      await db.destroy();

      const result = await repo.deleteBy();

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message.length).toBeGreaterThan(0);
      }
    });
  });

  describe('findLatestIncomplete', () => {
    it('returns latest started or failed session for an account', async () => {
      const startedId = await insertSession(db, {
        accountId: 1,
        status: 'started',
        startedAt: '2024-01-01T10:00:00.000Z',
      });
      const failedId = await insertSession(db, {
        accountId: 1,
        status: 'failed',
        startedAt: '2024-01-01T11:00:00.000Z',
      });
      await insertSession(db, {
        accountId: 1,
        status: 'completed',
        startedAt: '2024-01-01T12:00:00.000Z',
      });
      await insertSession(db, {
        accountId: 1,
        status: 'cancelled',
        startedAt: '2024-01-01T13:00:00.000Z',
      });

      const result = await repo.findLatestIncomplete(1);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value?.id).toBe(failedId);
        expect(result.value?.status).toBe('failed');
        expect(result.value?.id).not.toBe(startedId);
      }
    });

    it('returns undefined when account has no started/failed sessions', async () => {
      await insertSession(db, {
        accountId: 2,
        status: 'completed',
        startedAt: '2024-01-01T12:00:00.000Z',
      });
      await insertSession(db, {
        accountId: 2,
        status: 'cancelled',
        startedAt: '2024-01-01T13:00:00.000Z',
      });

      const result = await repo.findLatestIncomplete(2);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBeUndefined();
      }
    });

    it('returns an error when the database is closed', async () => {
      await db.destroy();

      const result = await repo.findLatestIncomplete(1);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message.length).toBeGreaterThan(0);
      }
    });
  });
});
