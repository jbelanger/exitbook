/* eslint-disable unicorn/no-null -- db null is ok */
import { assertOk } from '@exitbook/core/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { KyselyDB } from '../../database.js';
import { createTestDatabase } from '../../utils/test-utils.js';
import { ProjectionStateRepository } from '../projection-state-repository.js';

describe('ProjectionStateRepository', () => {
  let db: KyselyDB;
  let repo: ProjectionStateRepository;

  beforeEach(async () => {
    db = await createTestDatabase();
    repo = new ProjectionStateRepository(db);
  });

  afterEach(async () => {
    await db.destroy();
  });

  describe('get', () => {
    it('returns undefined when no state exists', async () => {
      const row = assertOk(await repo.get('processed-transactions'));
      expect(row).toBeUndefined();
    });

    it('returns the row after upsert', async () => {
      assertOk(
        await repo.upsert({
          projectionId: 'processed-transactions',
          scopeKey: '__global__',
          status: 'fresh',
          lastBuiltAt: new Date('2026-01-01T00:00:00.000Z'),
          lastInvalidatedAt: null,
          invalidatedBy: null,
          metadata: { accountHash: 'abc123' },
        })
      );

      const row = assertOk(await repo.get('processed-transactions'));
      expect(row).toBeDefined();
      expect(row!.projectionId).toBe('processed-transactions');
      expect(row!.status).toBe('fresh');
      expect(row!.lastBuiltAt).toEqual(new Date('2026-01-01T00:00:00.000Z'));
      expect(row!.metadata).toEqual({ accountHash: 'abc123' });
    });
  });

  describe('markStale', () => {
    it('creates a stale row if none exists', async () => {
      assertOk(await repo.markStale('links', 'import-completed'));

      const row = assertOk(await repo.get('links'));
      expect(row).toBeDefined();
      expect(row!.status).toBe('stale');
      expect(row!.invalidatedBy).toBe('import-completed');
      expect(row!.lastInvalidatedAt).toBeInstanceOf(Date);
    });

    it('updates existing row to stale', async () => {
      assertOk(await repo.markFresh('links', null));
      assertOk(await repo.markStale('links', 'upstream-rebuild'));

      const row = assertOk(await repo.get('links'));
      expect(row!.status).toBe('stale');
      expect(row!.invalidatedBy).toBe('upstream-rebuild');
    });
  });

  describe('markBuilding', () => {
    it('sets status to building', async () => {
      assertOk(await repo.markBuilding('processed-transactions'));

      const row = assertOk(await repo.get('processed-transactions'));
      expect(row!.status).toBe('building');
    });
  });

  describe('markFresh', () => {
    it('sets status to fresh with metadata', async () => {
      assertOk(await repo.markFresh('processed-transactions', { accountHash: 'xyz' }));

      const row = assertOk(await repo.get('processed-transactions'));
      expect(row!.status).toBe('fresh');
      expect(row!.lastBuiltAt).toBeInstanceOf(Date);
      expect(row!.metadata).toEqual({ accountHash: 'xyz' });
    });

    it('sets status to fresh with null metadata', async () => {
      assertOk(await repo.markFresh('links', null));

      const row = assertOk(await repo.get('links'));
      expect(row!.status).toBe('fresh');
      expect(row!.metadata).toBeNull();
    });

    it('clears stale-cause metadata when marking fresh', async () => {
      assertOk(await repo.markStale('links', 'upstream-rebuild'));
      const staleRow = assertOk(await repo.get('links'));
      expect(staleRow!.invalidatedBy).toBe('upstream-rebuild');
      expect(staleRow!.lastInvalidatedAt).toBeInstanceOf(Date);

      assertOk(await repo.markFresh('links', null));
      const freshRow = assertOk(await repo.get('links'));
      expect(freshRow!.status).toBe('fresh');
      expect(freshRow!.invalidatedBy).toBeNull();
      expect(freshRow!.lastInvalidatedAt).toBeNull();
    });
  });

  describe('markFailed', () => {
    it('sets status to failed', async () => {
      assertOk(await repo.markFailed('processed-transactions'));

      const row = assertOk(await repo.get('processed-transactions'));
      expect(row!.status).toBe('failed');
    });
  });

  describe('upsert', () => {
    it('overwrites existing row on conflict', async () => {
      assertOk(await repo.markFresh('links', { v: 1 }));
      assertOk(
        await repo.upsert({
          projectionId: 'links',
          scopeKey: '__global__',
          status: 'stale',
          lastBuiltAt: null,
          lastInvalidatedAt: new Date('2026-03-01T00:00:00.000Z'),
          invalidatedBy: 'manual',
          metadata: null,
        })
      );

      const row = assertOk(await repo.get('links'));
      expect(row!.status).toBe('stale');
      expect(row!.lastBuiltAt).toBeNull();
      expect(row!.invalidatedBy).toBe('manual');
      expect(row!.metadata).toBeNull();
    });
  });

  describe('scope_key isolation', () => {
    it('different scope keys are independent', async () => {
      assertOk(await repo.markFresh('processed-transactions', null, 'scope-a'));
      assertOk(await repo.markStale('processed-transactions', 'test', 'scope-b'));

      const a = assertOk(await repo.get('processed-transactions', 'scope-a'));
      const b = assertOk(await repo.get('processed-transactions', 'scope-b'));

      expect(a!.status).toBe('fresh');
      expect(b!.status).toBe('stale');
    });
  });

  describe('error handling', () => {
    it('returns error when database is closed', async () => {
      await db.destroy();

      const result = await repo.get('processed-transactions');
      expect(result.isErr()).toBe(true);
    });
  });
});
