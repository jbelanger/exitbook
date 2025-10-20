/* eslint-disable unicorn/no-null -- null needed by Kysely */
import type { KyselyDB, TransactionLinksTable } from '@exitbook/data';
import { getLogger, type Logger } from '@exitbook/shared-logger';
import type { Selectable } from 'kysely';
import { err, ok, type Result } from 'neverthrow';

import type { TransactionLink } from '../linking/types.js';

export type StoredTransactionLink = Selectable<TransactionLinksTable>;

/**
 * Repository for transaction link operations
 */
export class TransactionLinkRepository {
  private readonly db: KyselyDB;
  private readonly logger: Logger;

  constructor(db: KyselyDB) {
    this.db = db;
    this.logger = getLogger('TransactionLinkRepository');
  }

  /**
   * Create a new transaction link
   *
   * @param link - Link data to insert
   * @returns Result with the created link ID
   */
  async create(link: TransactionLink): Promise<Result<string, Error>> {
    try {
      await this.db
        .insertInto('transaction_links')
        .values({
          id: link.id,
          source_transaction_id: link.sourceTransactionId,
          target_transaction_id: link.targetTransactionId,
          link_type: link.linkType,
          confidence_score: link.confidenceScore.toString(),
          match_criteria_json: this.serializeToJson(link.matchCriteria) ?? '{}',
          status: link.status,
          reviewed_by: link.reviewedBy ?? null,
          reviewed_at: link.reviewedAt ? link.reviewedAt.toISOString() : null,
          created_at: link.createdAt.toISOString(),
          updated_at: link.updatedAt.toISOString(),
          metadata_json: this.serializeToJson(link.metadata) ?? null,
        })
        .execute();

      this.logger.debug({ linkId: link.id }, 'Created transaction link');
      return ok(link.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error({ error }, 'Failed to create transaction link');
      return err(new Error(`Failed to create transaction link: ${message}`));
    }
  }

  /**
   * Bulk create transaction links
   *
   * @param links - Array of links to create
   * @returns Result with count of created links
   */
  async createBulk(links: TransactionLink[]): Promise<Result<number, Error>> {
    try {
      if (links.length === 0) {
        return ok(0);
      }

      const values = links.map((link) => ({
        id: link.id,
        source_transaction_id: link.sourceTransactionId,
        target_transaction_id: link.targetTransactionId,
        link_type: link.linkType,
        confidence_score: link.confidenceScore.toString(),
        match_criteria_json: this.serializeToJson(link.matchCriteria) ?? '{}',
        status: link.status,
        reviewed_by: link.reviewedBy ?? null,
        reviewed_at: link.reviewedAt ? link.reviewedAt.toISOString() : null,
        created_at: link.createdAt.toISOString(),
        updated_at: link.updatedAt.toISOString(),
        metadata_json: this.serializeToJson(link.metadata) ?? null,
      }));

      await this.db.insertInto('transaction_links').values(values).execute();

      this.logger.info({ count: links.length }, 'Bulk created transaction links');
      return ok(links.length);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error({ error }, 'Failed to bulk create transaction links');
      return err(new Error(`Failed to bulk create transaction links: ${message}`));
    }
  }

  /**
   * Find link by ID
   *
   * @param id - Link ID
   * @returns Result with link or null if not found
   */
  async findById(id: string): Promise<Result<StoredTransactionLink | null, Error>> {
    try {
      const link = await this.db.selectFrom('transaction_links').selectAll().where('id', '=', id).executeTakeFirst();

      return ok(link ?? null);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error({ error, id }, 'Failed to find transaction link by ID');
      return err(new Error(`Failed to find transaction link: ${message}`));
    }
  }

  /**
   * Find links by source transaction ID
   *
   * @param sourceTransactionId - Source transaction ID
   * @returns Result with array of links
   */
  async findBySourceTransactionId(sourceTransactionId: number): Promise<Result<StoredTransactionLink[], Error>> {
    try {
      const links = await this.db
        .selectFrom('transaction_links')
        .selectAll()
        .where('source_transaction_id', '=', sourceTransactionId)
        .execute();

      return ok(links);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error({ error, sourceTransactionId }, 'Failed to find links by source transaction');
      return err(new Error(`Failed to find links by source transaction: ${message}`));
    }
  }

  /**
   * Find links by target transaction ID
   *
   * @param targetTransactionId - Target transaction ID
   * @returns Result with array of links
   */
  async findByTargetTransactionId(targetTransactionId: number): Promise<Result<StoredTransactionLink[], Error>> {
    try {
      const links = await this.db
        .selectFrom('transaction_links')
        .selectAll()
        .where('target_transaction_id', '=', targetTransactionId)
        .execute();

      return ok(links);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error({ error, targetTransactionId }, 'Failed to find links by target transaction');
      return err(new Error(`Failed to find links by target transaction: ${message}`));
    }
  }

  /**
   * Find all links with optional status filter
   *
   * @param status - Optional status filter
   * @returns Result with array of links
   */
  async findAll(status?: 'suggested' | 'confirmed' | 'rejected'): Promise<Result<StoredTransactionLink[], Error>> {
    try {
      let query = this.db.selectFrom('transaction_links').selectAll();

      if (status) {
        query = query.where('status', '=', status);
      }

      const links = await query.execute();
      return ok(links);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error({ error, status }, 'Failed to find transaction links');
      return err(new Error(`Failed to find transaction links: ${message}`));
    }
  }

  /**
   * Update link status
   *
   * @param id - Link ID
   * @param status - New status
   * @param reviewedBy - User who reviewed
   * @returns Result with success boolean
   */
  async updateStatus(
    id: string,
    status: 'suggested' | 'confirmed' | 'rejected',
    reviewedBy: string
  ): Promise<Result<boolean, Error>> {
    try {
      const now = new Date().toISOString();

      const result = await this.db
        .updateTable('transaction_links')
        .set({
          status,
          reviewed_by: reviewedBy,
          reviewed_at: now,
          updated_at: now,
        })
        .where('id', '=', id)
        .execute();

      const updated = result[0] ? Number(result[0].numUpdatedRows ?? 0) > 0 : false;
      this.logger.debug({ linkId: id, status, updated }, 'Updated transaction link status');
      return ok(updated);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error({ error, id, status }, 'Failed to update transaction link status');
      return err(new Error(`Failed to update transaction link status: ${message}`));
    }
  }

  /**
   * Delete a transaction link
   *
   * @param id - Link ID
   * @returns Result with success boolean
   */
  async delete(id: string): Promise<Result<boolean, Error>> {
    try {
      const result = await this.db.deleteFrom('transaction_links').where('id', '=', id).execute();

      const deleted = result[0] ? Number(result[0].numDeletedRows ?? 0) > 0 : false;
      this.logger.debug({ linkId: id, deleted }, 'Deleted transaction link');
      return ok(deleted);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error({ error, id }, 'Failed to delete transaction link');
      return err(new Error(`Failed to delete transaction link: ${message}`));
    }
  }

  /**
   * Delete all links for a source transaction
   *
   * @param sourceTransactionId - Source transaction ID
   * @returns Result with count of deleted links
   */
  async deleteBySourceTransactionId(sourceTransactionId: number): Promise<Result<number, Error>> {
    try {
      const result = await this.db
        .deleteFrom('transaction_links')
        .where('source_transaction_id', '=', sourceTransactionId)
        .execute();

      const count = result[0] ? Number(result[0].numDeletedRows ?? 0) : 0;
      this.logger.debug({ sourceTransactionId, count }, 'Deleted transaction links by source transaction');
      return ok(count);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error({ error, sourceTransactionId }, 'Failed to delete links by source transaction');
      return err(new Error(`Failed to delete links by source transaction: ${message}`));
    }
  }

  /**
   * Delete all links where source transactions match a specific source_id
   *
   * @param sourceId - Source ID to match (e.g., 'kraken', 'ethereum')
   * @returns Result with count of deleted links
   */
  async deleteBySource(sourceId: string): Promise<Result<number, Error>> {
    try {
      const result = await this.db
        .deleteFrom('transaction_links')
        .where(
          'source_transaction_id',
          'in',
          this.db.selectFrom('transactions').select('id').where('source_id', '=', sourceId)
        )
        .executeTakeFirst();

      const count = Number(result.numDeletedRows ?? 0);
      this.logger.debug({ sourceId, count }, 'Deleted transaction links by source');
      return ok(count);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error({ error, sourceId }, 'Failed to delete links by source');
      return err(new Error(`Failed to delete links by source: ${message}`));
    }
  }

  /**
   * Delete all transaction links
   *
   * @returns Result with count of deleted links
   */
  async deleteAll(): Promise<Result<number, Error>> {
    try {
      const result = await this.db.deleteFrom('transaction_links').executeTakeFirst();

      const count = Number(result.numDeletedRows ?? 0);
      this.logger.info({ count }, 'Deleted all transaction links');
      return ok(count);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error({ error }, 'Failed to delete all links');
      return err(new Error(`Failed to delete all links: ${message}`));
    }
  }

  /**
   * Helper method to serialize data to JSON string safely
   * Handles Decimal objects by converting them to strings
   */
  private serializeToJson(data: unknown): string | undefined {
    if (data === undefined || data === null) return undefined;

    try {
      return JSON.stringify(data, (_key, value: unknown) => {
        // Convert Decimal objects to strings for proper serialization
        if (
          value &&
          typeof value === 'object' &&
          'd' in value &&
          'e' in value &&
          's' in value &&
          'toString' in value &&
          typeof value.toString === 'function'
        ) {
          // This is likely a Decimal.js object (has d, e, s properties and toString method)
          return (value as { toString: () => string }).toString();
        }
        return value as string | number | boolean | null | object;
      });
    } catch (error) {
      this.logger.warn({ data, error }, 'Failed to serialize data to JSON');
      return undefined;
    }
  }
}
