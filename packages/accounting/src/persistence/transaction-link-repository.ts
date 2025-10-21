/* eslint-disable unicorn/no-null -- null needed by Kysely */
import { DecimalSchema, wrapError } from '@exitbook/core';
import type { KyselyDB, TransactionLinksTable } from '@exitbook/data';
import { BaseRepository } from '@exitbook/data';
import type { Selectable } from 'kysely';
import { err, ok, type Result } from 'neverthrow';

import { MatchCriteriaSchema } from '../linking/schemas.js';
import type { TransactionLink } from '../linking/types.js';

export type StoredTransactionLink = Selectable<TransactionLinksTable>;

/**
 * Repository for transaction link operations
 */
export class TransactionLinkRepository extends BaseRepository {
  constructor(db: KyselyDB) {
    super(db, 'TransactionLinkRepository');
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
      this.logger.error({ error }, 'Failed to create transaction link');
      return wrapError(error, 'Failed to create transaction link');
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
      this.logger.error({ error }, 'Failed to bulk create transaction links');
      return wrapError(error, 'Failed to bulk create transaction links');
    }
  }

  /**
   * Find link by ID
   *
   * @param id - Link ID
   * @returns Result with link or null if not found
   */
  async findById(id: string): Promise<Result<TransactionLink | null, Error>> {
    try {
      const row = await this.db.selectFrom('transaction_links').selectAll().where('id', '=', id).executeTakeFirst();

      if (!row) {
        return ok(null);
      }

      const result = this.toTransactionLink(row);
      if (result.isErr()) {
        return err(result.error);
      }

      return ok(result.value);
    } catch (error) {
      this.logger.error({ error, id }, 'Failed to find transaction link by ID');
      return wrapError(error, 'Failed to find transaction link');
    }
  }

  /**
   * Find links by source transaction ID
   *
   * @param sourceTransactionId - Source transaction ID
   * @returns Result with array of links
   */
  async findBySourceTransactionId(sourceTransactionId: number): Promise<Result<TransactionLink[], Error>> {
    try {
      const rows = await this.db
        .selectFrom('transaction_links')
        .selectAll()
        .where('source_transaction_id', '=', sourceTransactionId)
        .execute();

      // Convert rows to domain models, failing fast on any parse errors
      const links: TransactionLink[] = [];
      for (const row of rows) {
        const result = this.toTransactionLink(row);
        if (result.isErr()) {
          return err(result.error);
        }
        links.push(result.value);
      }

      return ok(links);
    } catch (error) {
      this.logger.error({ error, sourceTransactionId }, 'Failed to find links by source transaction');
      return wrapError(error, 'Failed to find links by source transaction');
    }
  }

  /**
   * Find links by target transaction ID
   *
   * @param targetTransactionId - Target transaction ID
   * @returns Result with array of links
   */
  async findByTargetTransactionId(targetTransactionId: number): Promise<Result<TransactionLink[], Error>> {
    try {
      const rows = await this.db
        .selectFrom('transaction_links')
        .selectAll()
        .where('target_transaction_id', '=', targetTransactionId)
        .execute();

      // Convert rows to domain models, failing fast on any parse errors
      const links: TransactionLink[] = [];
      for (const row of rows) {
        const result = this.toTransactionLink(row);
        if (result.isErr()) {
          return err(result.error);
        }
        links.push(result.value);
      }

      return ok(links);
    } catch (error) {
      this.logger.error({ error, targetTransactionId }, 'Failed to find links by target transaction');
      return wrapError(error, 'Failed to find links by target transaction');
    }
  }

  /**
   * Find all links with optional status filter
   *
   * @param status - Optional status filter
   * @returns Result with array of links
   */
  async findAll(status?: 'suggested' | 'confirmed' | 'rejected'): Promise<Result<TransactionLink[], Error>> {
    try {
      let query = this.db.selectFrom('transaction_links').selectAll();

      if (status) {
        query = query.where('status', '=', status);
      }

      const rows = await query.execute();

      // Convert rows to domain models, failing fast on any parse errors
      const links: TransactionLink[] = [];
      for (const row of rows) {
        const result = this.toTransactionLink(row);
        if (result.isErr()) {
          return err(result.error);
        }
        links.push(result.value);
      }

      return ok(links);
    } catch (error) {
      this.logger.error({ error, status }, 'Failed to find transaction links');
      return wrapError(error, 'Failed to find transaction links');
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
      this.logger.error({ error, id, status }, 'Failed to update transaction link status');
      return wrapError(error, 'Failed to update transaction link status');
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
      this.logger.error({ error, id }, 'Failed to delete transaction link');
      return wrapError(error, 'Failed to delete transaction link');
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
      this.logger.error({ error, sourceTransactionId }, 'Failed to delete links by source transaction');
      return wrapError(error, 'Failed to delete links by source transaction');
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
      this.logger.error({ error, sourceId }, 'Failed to delete links by source');
      return wrapError(error, 'Failed to delete links by source');
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
      this.logger.error({ error }, 'Failed to delete all links');
      return wrapError(error, 'Failed to delete all links');
    }
  }

  /**
   * Convert database row to TransactionLink domain model
   * Uses Zod schema for validation and automatic Decimal transformation
   */
  private toTransactionLink(row: StoredTransactionLink): Result<TransactionLink, Error> {
    // Parse and validate matchCriteria with schema (handles Decimal rehydration automatically)
    const matchCriteriaResult = this.parseWithSchema(row.match_criteria_json, MatchCriteriaSchema);
    if (matchCriteriaResult.isErr()) {
      return err(matchCriteriaResult.error);
    }
    if (matchCriteriaResult.value === undefined) {
      return err(new Error('match_criteria_json is required but was undefined'));
    }

    const metadataResult = this.parseJson<Record<string, unknown>>(row.metadata_json);
    if (metadataResult.isErr()) {
      return err(metadataResult.error);
    }

    return ok({
      id: row.id,
      sourceTransactionId: row.source_transaction_id,
      targetTransactionId: row.target_transaction_id,
      linkType: row.link_type,
      confidenceScore: DecimalSchema.parse(row.confidence_score),
      matchCriteria: matchCriteriaResult.value,
      status: row.status,
      reviewedBy: row.reviewed_by ?? undefined,
      reviewedAt: row.reviewed_at ? new Date(row.reviewed_at) : undefined,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      metadata: metadataResult.value,
    });
  }
}
