/* eslint-disable unicorn/no-null -- null needed for db */
import { createTestDatabase } from '@exitbook/data';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { KyselyDB } from '../../storage/initialization.js';
import { RawTransactionRepository } from '../raw-transaction-repository.js';

import { seedAccount, seedImportSession, seedUser } from './helpers.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function seedDatabase(db: KyselyDB): Promise<void> {
  await seedUser(db);
  await seedAccount(db, 1, 'exchange-api', 'kraken');
  await seedAccount(db, 2, 'blockchain', 'ethereum');
  await seedImportSession(db, 1, 1);
  await seedImportSession(db, 2, 2);

  // 5 raw transactions: 3 for account 1 (kraken), 2 for account 2 (ethereum).
  // Even-indexed rows are 'processed', odd-indexed are 'pending'.
  for (let i = 1; i <= 5; i++) {
    await db
      .insertInto('raw_transactions')
      .values({
        account_id: i <= 3 ? 1 : 2,
        provider_name: i <= 3 ? 'kraken' : 'ethereum',
        event_id: `ext-${i}`,
        blockchain_transaction_hash: null,
        source_address: null,
        transaction_type_hint: null,
        provider_data: JSON.stringify({ id: `ext-${i}`, amount: '100.00' }),
        normalized_data: '{}',
        processing_status: i % 2 === 0 ? 'processed' : 'pending',
        processed_at: i % 2 === 0 ? new Date().toISOString() : undefined,
        created_at: new Date().toISOString(),
        timestamp: Date.now(),
      })
      .execute();
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RawTransactionRepository', () => {
  let db: KyselyDB;
  let repo: RawTransactionRepository;

  beforeEach(async () => {
    db = await createTestDatabase();
    repo = new RawTransactionRepository(db);
    await seedDatabase(db);
  });

  afterEach(async () => {
    await db.destroy();
  });

  describe('resetProcessingStatus', () => {
    it('resets processing status for records from a specific account', async () => {
      const initialProcessed = await db
        .selectFrom('raw_transactions')
        .where('processing_status', '=', 'processed')
        .where('account_id', '=', 1)
        .selectAll()
        .execute();
      expect(initialProcessed.length).toBeGreaterThan(0);

      const result = await repo.resetProcessingStatus({ accountId: 1 });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(3);
      }

      const krakenRows = await db.selectFrom('raw_transactions').where('account_id', '=', 1).selectAll().execute();
      expect(krakenRows).toHaveLength(3);
      expect(krakenRows.every((r) => r.processing_status === 'pending')).toBe(true);
      expect(krakenRows.every((r) => r.processed_at === null)).toBe(true);

      // Ethereum records remain unchanged
      const ethereumProcessed = await db
        .selectFrom('raw_transactions')
        .where('processing_status', '=', 'processed')
        .where('account_id', '=', 2)
        .selectAll()
        .execute();
      expect(ethereumProcessed.length).toBeGreaterThan(0);
    });

    it('returns 0 when the account has no records', async () => {
      const result = await repo.resetProcessingStatus({ accountId: 999 });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(0);
      }
    });

    it('resets processing status for all records when no filter is given', async () => {
      const result = await repo.resetProcessingStatus();

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(5);
      }

      const allRows = await db.selectFrom('raw_transactions').selectAll().execute();
      expect(allRows.every((r) => r.processing_status === 'pending')).toBe(true);
      expect(allRows.every((r) => r.processed_at === null)).toBe(true);
    });

    it('returns 0 when no records exist', async () => {
      await db.deleteFrom('raw_transactions').execute();

      const result = await repo.resetProcessingStatus();

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(0);
      }
    });

    it('returns an error when the database is closed', async () => {
      await db.destroy();

      const result = await repo.resetProcessingStatus({ accountId: 1 });

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message.length).toBeGreaterThan(0);
      }
    });
  });

  describe('deleteAll', () => {
    it('deletes records for a specific account', async () => {
      const result = await repo.deleteAll({ accountId: 1 });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(3);
      }

      const remaining = await db.selectFrom('raw_transactions').selectAll().execute();
      expect(remaining).toHaveLength(2);
      expect(remaining.every((r) => r.account_id === 2)).toBe(true);
    });

    it('returns 0 when the account has no records', async () => {
      const result = await repo.deleteAll({ accountId: 999 });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(0);
      }

      const allRows = await db.selectFrom('raw_transactions').selectAll().execute();
      expect(allRows).toHaveLength(5);
    });

    it('deletes all records when no filter is given', async () => {
      const result = await repo.deleteAll();

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(5);
      }

      const remaining = await db.selectFrom('raw_transactions').selectAll().execute();
      expect(remaining).toHaveLength(0);
    });

    it('returns 0 when no records exist', async () => {
      await db.deleteFrom('raw_transactions').execute();

      const result = await repo.deleteAll();

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(0);
      }
    });

    it('returns an error when the database is closed', async () => {
      await db.destroy();

      const result = await repo.deleteAll();

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message.length).toBeGreaterThan(0);
      }
    });
  });

  describe('findByHashBatch', () => {
    beforeEach(async () => {
      await db.deleteFrom('raw_transactions').execute();

      // hash-1: 3 events (normal, internal, token) — account 2
      // hash-2: 2 events (normal, internal)         — account 2
      // hash-3: 1 event  (normal)                   — account 2
      // hash-4: 1 event  (processed, filtered out)  — account 2
      // hash-other: 1 event (pending)               — account 1
      const rows = [
        { hash: 'hash-1', hint: 'normal', evtId: 'evt-1-1', createdAt: '2024-01-01T10:00:00Z' },
        { hash: 'hash-1', hint: 'internal', evtId: 'evt-1-2', createdAt: '2024-01-01T10:00:01Z' },
        { hash: 'hash-1', hint: 'token', evtId: 'evt-1-3', createdAt: '2024-01-01T10:00:02Z' },
        { hash: 'hash-2', hint: 'normal', evtId: 'evt-2-1', createdAt: '2024-01-01T11:00:00Z' },
        { hash: 'hash-2', hint: 'internal', evtId: 'evt-2-2', createdAt: '2024-01-01T11:00:01Z' },
        { hash: 'hash-3', hint: 'normal', evtId: 'evt-3-1', createdAt: '2024-01-01T12:00:00Z' },
      ] as const;

      for (const row of rows) {
        await db
          .insertInto('raw_transactions')
          .values({
            account_id: 2,
            provider_name: 'alchemy',
            event_id: row.evtId,
            blockchain_transaction_hash: row.hash,
            source_address: null,
            transaction_type_hint: row.hint,
            provider_data: JSON.stringify({ type: row.hint }),
            normalized_data: JSON.stringify({ type: row.hint }),
            processing_status: 'pending',
            processed_at: undefined,
            created_at: new Date(row.createdAt).toISOString(),
            timestamp: Date.now(),
          })
          .execute();
      }

      // hash-4: processed — should be filtered out
      await db
        .insertInto('raw_transactions')
        .values({
          account_id: 2,
          provider_name: 'alchemy',
          event_id: 'evt-4-1',
          blockchain_transaction_hash: 'hash-4',
          source_address: null,
          transaction_type_hint: 'normal',
          provider_data: JSON.stringify({ type: 'normal' }),
          normalized_data: JSON.stringify({ type: 'normal' }),
          processing_status: 'processed',
          processed_at: new Date().toISOString(),
          created_at: new Date('2024-01-01T13:00:00Z').toISOString(),
          timestamp: Date.now(),
        })
        .execute();

      // Different account — should be filtered out
      await db
        .insertInto('raw_transactions')
        .values({
          account_id: 1,
          provider_name: 'kraken',
          event_id: 'evt-other',
          blockchain_transaction_hash: 'hash-other',
          source_address: null,
          transaction_type_hint: null,
          provider_data: JSON.stringify({ type: 'exchange' }),
          normalized_data: JSON.stringify({ type: 'exchange' }),
          processing_status: 'pending',
          processed_at: undefined,
          created_at: new Date('2024-01-01T14:00:00Z').toISOString(),
          timestamp: Date.now(),
        })
        .execute();
    });

    it('returns all events for the first N distinct hashes', async () => {
      const result = await repo.findByHashBatch(2, 2);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        // 3 events from hash-1 + 2 events from hash-2
        expect(result.value).toHaveLength(5);

        const hashes = new Set(result.value.map((t) => t.blockchainTransactionHash));
        expect(hashes).toEqual(new Set(['hash-1', 'hash-2']));
      }
    });

    it('returns all events for a hash as a group', async () => {
      const result = await repo.findByHashBatch(2, 1);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toHaveLength(3);
        expect(result.value.every((t) => t.blockchainTransactionHash === 'hash-1')).toBe(true);

        const hints = result.value.map((t) => t.transactionTypeHint).sort();
        expect(hints).toEqual(['internal', 'normal', 'token']);
      }
    });

    it('returns all pending events when hash limit exceeds available hashes', async () => {
      const result = await repo.findByHashBatch(2, 10);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        // 3 + 2 + 1 = 6 pending events across 3 hashes
        expect(result.value).toHaveLength(6);

        const hashes = new Set(result.value.map((t) => t.blockchainTransactionHash));
        expect(hashes.size).toBe(3);
      }
    });

    it('orders results by hash then by id within each hash', async () => {
      const result = await repo.findByHashBatch(2, 10);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const txs = result.value;

        expect(txs.slice(0, 3).map((t) => t.blockchainTransactionHash)).toEqual(['hash-1', 'hash-1', 'hash-1']);
        expect(txs.slice(3, 5).map((t) => t.blockchainTransactionHash)).toEqual(['hash-2', 'hash-2']);
        expect(txs.slice(5, 6).map((t) => t.blockchainTransactionHash)).toEqual(['hash-3']);

        for (let i = 1; i < txs.length; i++) {
          const prev = txs[i - 1];
          const curr = txs[i];
          if (curr && prev && curr.blockchainTransactionHash === prev.blockchainTransactionHash) {
            expect(curr.id).toBeGreaterThan(prev.id);
          }
        }
      }
    });

    it('filters by account ID', async () => {
      const result = await repo.findByHashBatch(1, 10);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0]?.accountId).toBe(1);
        expect(result.value[0]?.blockchainTransactionHash).toBe('hash-other');
      }
    });

    it('excludes processed events', async () => {
      const result = await repo.findByHashBatch(2, 10);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.every((t) => t.blockchainTransactionHash !== 'hash-4')).toBe(true);
        expect(result.value.every((t) => t.processingStatus === 'pending')).toBe(true);
      }
    });

    it('returns an empty array when all records are processed', async () => {
      await db
        .updateTable('raw_transactions')
        .set({ processing_status: 'processed', processed_at: new Date().toISOString() })
        .execute();

      const result = await repo.findByHashBatch(2, 10);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toHaveLength(0);
      }
    });

    it('returns an empty array for a non-existent account', async () => {
      const result = await repo.findByHashBatch(999, 10);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toHaveLength(0);
      }
    });

    it('returns an error when the database is closed', async () => {
      await db.destroy();

      const result = await repo.findByHashBatch(2, 10);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message.length).toBeGreaterThan(0);
      }
    });
  });
});
