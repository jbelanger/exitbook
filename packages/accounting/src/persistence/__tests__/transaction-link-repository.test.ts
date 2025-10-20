/* eslint-disable unicorn/no-null -- null required for db */
import { parseDecimal } from '@exitbook/core';
import { createDatabase, runMigrations, type KyselyDB } from '@exitbook/data';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { TransactionLink } from '../../linking/types.js';
import { TransactionLinkRepository } from '../transaction-link-repository.js';

describe('TransactionLinkRepository', () => {
  let db: KyselyDB;
  let repository: TransactionLinkRepository;

  beforeEach(async () => {
    db = createDatabase(':memory:');
    await runMigrations(db);
    repository = new TransactionLinkRepository(db);

    // Create mock import session for foreign key constraints
    await db
      .insertInto('import_sessions')
      .values({
        source_type: 'exchange',
        source_id: 'test',
        started_at: new Date().toISOString(),
        status: 'completed',
        import_params: '{}',
        import_result_metadata: '{}',
        transactions_imported: 0,
        transactions_failed: 0,
        created_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      })
      .execute();

    // Create test transactions that we can reference
    for (let i = 1; i <= 10; i++) {
      await db
        .insertInto('transactions')
        .values({
          import_session_id: 1,
          source_id: 'test',
          source_type: 'exchange' as const,
          external_id: `tx-${i}`,
          transaction_status: 'confirmed' as const,
          transaction_datetime: new Date().toISOString(),
          verified: false,
          raw_normalized_data: '{}',
          movements_inflows: null,
          movements_outflows: JSON.stringify([{ asset: 'BTC', amount: '1.0' }]),
          created_at: new Date().toISOString(),
        })
        .execute();
    }
  });

  afterEach(async () => {
    await db.destroy();
  });

  const createMockLink = (overrides: Partial<TransactionLink> = {}): TransactionLink => ({
    id: 'link-123',
    sourceTransactionId: 1,
    targetTransactionId: 2,
    linkType: 'exchange_to_blockchain',
    confidenceScore: parseDecimal('0.95'),
    matchCriteria: {
      assetMatch: true,
      amountSimilarity: parseDecimal('1.0'),
      timingValid: true,
      timingHours: 1.5,
      addressMatch: true,
    },
    status: 'suggested',
    createdAt: new Date('2024-01-01T12:00:00Z'),
    updatedAt: new Date('2024-01-01T12:00:00Z'),
    ...overrides,
  });

  describe('create', () => {
    it('should successfully create a transaction link', async () => {
      const link = createMockLink();

      const result = await repository.create(link);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(link.id);
      }

      // Verify link was stored
      const findResult = await repository.findById(link.id);
      expect(findResult.isOk()).toBe(true);
      if (findResult.isOk() && findResult.value) {
        expect(findResult.value.id).toBe(link.id);
        expect(findResult.value.source_transaction_id).toBe(link.sourceTransactionId);
        expect(findResult.value.target_transaction_id).toBe(link.targetTransactionId);
      }
    });

    it('should create link with metadata', async () => {
      const link = createMockLink({
        metadata: { notes: 'manual review', confidence: 'high' },
      });

      const result = await repository.create(link);

      expect(result.isOk()).toBe(true);

      const findResult = await repository.findById(link.id);
      expect(findResult.isOk()).toBe(true);
      if (findResult.isOk() && findResult.value) {
        expect(findResult.value.metadata_json).toBeTruthy();
      }
    });
  });

  describe('createBulk', () => {
    it('should create multiple transaction links at once', async () => {
      const links = [
        createMockLink({ id: 'link-1', sourceTransactionId: 1, targetTransactionId: 2 }),
        createMockLink({ id: 'link-2', sourceTransactionId: 3, targetTransactionId: 4 }),
        createMockLink({ id: 'link-3', sourceTransactionId: 5, targetTransactionId: 6 }),
      ];

      const result = await repository.createBulk(links);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(3);
      }

      // Verify all links were created
      for (const link of links) {
        const findResult = await repository.findById(link.id);
        expect(findResult.isOk()).toBe(true);
        if (findResult.isOk()) {
          expect(findResult.value).toBeTruthy();
        }
      }
    });

    it('should return 0 for empty array', async () => {
      const result = await repository.createBulk([]);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(0);
      }
    });
  });

  describe('findById', () => {
    it('should find existing link by ID', async () => {
      const link = createMockLink();
      await repository.create(link);

      const result = await repository.findById(link.id);

      expect(result.isOk()).toBe(true);
      if (result.isOk() && result.value) {
        expect(result.value.id).toBe(link.id);
      }
    });

    it('should return null for non-existent ID', async () => {
      const result = await repository.findById('non-existent-id');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBeNull();
      }
    });
  });

  describe('findBySourceTransactionId', () => {
    it('should find all links for a source transaction', async () => {
      const sourceId = 1;
      const links = [
        createMockLink({ id: 'link-1', sourceTransactionId: sourceId, targetTransactionId: 2 }),
        createMockLink({ id: 'link-2', sourceTransactionId: sourceId, targetTransactionId: 3 }),
      ];

      await repository.createBulk(links);

      const result = await repository.findBySourceTransactionId(sourceId);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toHaveLength(2);
      }
    });

    it('should return empty array for transaction with no links', async () => {
      const result = await repository.findBySourceTransactionId(999);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toEqual([]);
      }
    });
  });

  describe('findAll', () => {
    it('should find all links without filter', async () => {
      const links = [
        createMockLink({ id: 'link-1', status: 'suggested' }),
        createMockLink({ id: 'link-2', status: 'confirmed' }),
      ];
      await repository.createBulk(links);

      const result = await repository.findAll();

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.length).toBeGreaterThanOrEqual(2);
      }
    });

    it('should filter by status', async () => {
      const links = [
        createMockLink({ id: 'link-1', status: 'suggested' }),
        createMockLink({ id: 'link-2', status: 'confirmed' }),
      ];
      await repository.createBulk(links);

      const result = await repository.findAll('suggested');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.length).toBeGreaterThanOrEqual(1);
        expect(result.value.every((link) => link.status === 'suggested')).toBe(true);
      }
    });
  });

  describe('updateStatus', () => {
    it('should update link status with review info', async () => {
      const link = createMockLink({ status: 'suggested' });
      await repository.create(link);

      const result = await repository.updateStatus(link.id, 'confirmed', 'user-123');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(true);
      }

      // Verify update
      const findResult = await repository.findById(link.id);
      expect(findResult.isOk()).toBe(true);
      if (findResult.isOk() && findResult.value) {
        expect(findResult.value.status).toBe('confirmed');
        expect(findResult.value.reviewed_by).toBe('user-123');
      }
    });

    it('should return false for non-existent link', async () => {
      const result = await repository.updateStatus('non-existent', 'confirmed', 'user-123');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(false);
      }
    });
  });

  describe('delete', () => {
    it('should delete existing link', async () => {
      const link = createMockLink();
      await repository.create(link);

      const result = await repository.delete(link.id);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(true);
      }

      // Verify deletion
      const findResult = await repository.findById(link.id);
      expect(findResult.isOk()).toBe(true);
      if (findResult.isOk()) {
        expect(findResult.value).toBeNull();
      }
    });

    it('should return false for non-existent link', async () => {
      const result = await repository.delete('non-existent-id');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(false);
      }
    });
  });

  describe('deleteBySourceTransactionId', () => {
    it('should delete all links for a source transaction', async () => {
      const sourceId = 1;
      const links = [
        createMockLink({ id: 'link-1', sourceTransactionId: sourceId, targetTransactionId: 2 }),
        createMockLink({ id: 'link-2', sourceTransactionId: sourceId, targetTransactionId: 3 }),
      ];

      await repository.createBulk(links);

      const result = await repository.deleteBySourceTransactionId(sourceId);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(2);
      }

      // Verify deletions
      const findResult = await repository.findBySourceTransactionId(sourceId);
      expect(findResult.isOk()).toBe(true);
      if (findResult.isOk()) {
        expect(findResult.value).toHaveLength(0);
      }
    });

    it('should return 0 for transaction with no links', async () => {
      const result = await repository.deleteBySourceTransactionId(999);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(0);
      }
    });
  });

  describe('deleteBySource', () => {
    it('should delete all links where source transactions match a specific source_id', async () => {
      // Create links for different sources
      const links = [
        createMockLink({ id: 'link-1', sourceTransactionId: 1, targetTransactionId: 2 }), // source_id: 'test'
        createMockLink({ id: 'link-2', sourceTransactionId: 2, targetTransactionId: 3 }),
        createMockLink({ id: 'link-3', sourceTransactionId: 3, targetTransactionId: 4 }),
      ];

      await repository.createBulk(links);

      // Create additional transactions with different source_id
      await db
        .insertInto('import_sessions')
        .values({
          source_type: 'blockchain',
          source_id: 'ethereum',
          started_at: new Date().toISOString(),
          status: 'completed',
          import_params: '{}',
          import_result_metadata: '{}',
          transactions_imported: 0,
          transactions_failed: 0,
          created_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
        })
        .execute();

      await db
        .insertInto('transactions')
        .values({
          import_session_id: 2,
          source_id: 'ethereum',
          source_type: 'blockchain' as const,
          external_id: 'eth-tx-1',
          transaction_status: 'confirmed' as const,
          transaction_datetime: new Date().toISOString(),
          verified: false,
          raw_normalized_data: '{}',
          movements_inflows: JSON.stringify([{ asset: 'ETH', amount: '1.0' }]),
          movements_outflows: null,
          created_at: new Date().toISOString(),
        })
        .execute();

      const ethTx = await db
        .selectFrom('transactions')
        .where('source_id', '=', 'ethereum')
        .selectAll()
        .executeTakeFirst();

      // Create a link with ethereum transaction as source
      const ethLink = createMockLink({
        id: 'link-eth',
        sourceTransactionId: ethTx!.id,
        targetTransactionId: 1,
      });
      await repository.create(ethLink);

      // Delete links for 'test' source
      const result = await repository.deleteBySource('test');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(3); // Should delete 3 links (link-1, link-2, link-3)
      }

      // Verify only ethereum link remains
      const allLinks = await db.selectFrom('transaction_links').selectAll().execute();
      expect(allLinks).toHaveLength(1);
      expect(allLinks[0]!.id).toBe('link-eth');
    });

    it('should return 0 when no links match the source', async () => {
      const links = [createMockLink({ id: 'link-1', sourceTransactionId: 1, targetTransactionId: 2 })];
      await repository.createBulk(links);

      const result = await repository.deleteBySource('nonexistent');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(0);
      }

      // Verify link still exists
      const allLinks = await db.selectFrom('transaction_links').selectAll().execute();
      expect(allLinks).toHaveLength(1);
    });

    it('should handle database errors', async () => {
      await db.destroy();

      const result = await repository.deleteBySource('test');

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Failed to delete links by source');
      }
    });
  });

  describe('deleteAll', () => {
    it('should delete all transaction links', async () => {
      // Create multiple links
      const links = [
        createMockLink({ id: 'link-1', sourceTransactionId: 1, targetTransactionId: 2 }),
        createMockLink({ id: 'link-2', sourceTransactionId: 2, targetTransactionId: 3 }),
        createMockLink({ id: 'link-3', sourceTransactionId: 3, targetTransactionId: 4 }),
      ];

      await repository.createBulk(links);

      // Verify initial state
      const initialLinks = await db.selectFrom('transaction_links').selectAll().execute();
      expect(initialLinks).toHaveLength(3);

      // Delete all links
      const result = await repository.deleteAll();

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(3);
      }

      // Verify no links remain
      const remainingLinks = await db.selectFrom('transaction_links').selectAll().execute();
      expect(remainingLinks).toHaveLength(0);
    });

    it('should return 0 when no links exist', async () => {
      const result = await repository.deleteAll();

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(0);
      }
    });

    it('should handle database errors', async () => {
      await db.destroy();

      const result = await repository.deleteAll();

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Failed to delete all links');
      }
    });
  });
});
