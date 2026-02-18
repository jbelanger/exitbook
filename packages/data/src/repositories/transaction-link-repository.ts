/* eslint-disable unicorn/no-null -- null needed by Kysely */
import {
  DecimalSchema,
  MatchCriteriaSchema,
  TransactionLinkMetadataSchema,
  type LinkStatus,
  type TransactionLink,
  wrapError,
} from '@exitbook/core';
import type { Selectable } from 'kysely';
import { err, ok, type Result } from 'neverthrow';

import type { DatabaseSchema, TransactionLinksTable } from '../schema/database-schema.js';
import type { KyselyDB } from '../storage/database.js';

import { BaseRepository } from './base-repository.js';

export type TransactionLinkRow = Selectable<TransactionLinksTable>;

/**
 * Repository for transaction link operations
 */
export class TransactionLinkRepository extends BaseRepository<DatabaseSchema> {
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
      // Validate matchCriteria before saving
      const matchCriteriaValidation = MatchCriteriaSchema.safeParse(link.matchCriteria);
      if (!matchCriteriaValidation.success) {
        return err(new Error(`Invalid match criteria: ${matchCriteriaValidation.error.message}`));
      }

      // Validate metadata before saving
      if (link.metadata !== undefined) {
        const metadataValidation = TransactionLinkMetadataSchema.safeParse(link.metadata);
        if (!metadataValidation.success) {
          return err(new Error(`Invalid link metadata: ${metadataValidation.error.message}`));
        }
      }

      await this.db
        .insertInto('transaction_links')
        .values({
          id: link.id,
          source_transaction_id: link.sourceTransactionId,
          target_transaction_id: link.targetTransactionId,
          asset: link.assetSymbol,
          source_asset_id: link.sourceAssetId,
          target_asset_id: link.targetAssetId,
          source_amount: link.sourceAmount.toFixed(),
          target_amount: link.targetAmount.toFixed(),
          link_type: link.linkType,
          confidence_score: link.confidenceScore.toFixed(),
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

      // Validate all links before saving
      for (const link of links) {
        const matchCriteriaValidation = MatchCriteriaSchema.safeParse(link.matchCriteria);
        if (!matchCriteriaValidation.success) {
          return err(new Error(`Invalid match criteria for link ${link.id}: ${matchCriteriaValidation.error.message}`));
        }

        if (link.metadata !== undefined) {
          const metadataValidation = TransactionLinkMetadataSchema.safeParse(link.metadata);
          if (!metadataValidation.success) {
            return err(new Error(`Invalid metadata for link ${link.id}: ${metadataValidation.error.message}`));
          }
        }
      }

      const values = links.map((link) => ({
        id: link.id,
        source_transaction_id: link.sourceTransactionId,
        target_transaction_id: link.targetTransactionId,
        asset: link.assetSymbol,
        source_asset_id: link.sourceAssetId,
        target_asset_id: link.targetAssetId,
        source_amount: link.sourceAmount.toFixed(),
        target_amount: link.targetAmount.toFixed(),
        link_type: link.linkType,
        confidence_score: link.confidenceScore.toFixed(),
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
   * Find all links with optional status filter
   *
   * @param status - Optional status filter
   * @returns Result with array of links
   */
  async findAll(status?: LinkStatus): Promise<Result<TransactionLink[], Error>> {
    try {
      let query = this.db.selectFrom('transaction_links').selectAll();

      if (status) {
        query = query.where('status', '=', status);
      }

      // Order by creation time ascending (oldest to newest)
      query = query.orderBy('created_at', 'asc');

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
   * Find links by related transaction IDs (source or target).
   *
   * @param transactionIds - Transaction IDs to match
   * @returns Result with array of links
   */
  async findByTransactionIds(transactionIds: number[]): Promise<Result<TransactionLink[], Error>> {
    try {
      if (transactionIds.length === 0) {
        return ok([]);
      }

      const rows = await this.db
        .selectFrom('transaction_links')
        .selectAll()
        .where((eb) =>
          eb.or([eb('source_transaction_id', 'in', transactionIds), eb('target_transaction_id', 'in', transactionIds)])
        )
        .orderBy('created_at', 'asc')
        .execute();

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
      this.logger.error({ error, transactionIds }, 'Failed to find links by transaction IDs');
      return wrapError(error, 'Failed to find links by transaction IDs');
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
  async updateStatus(id: string, status: LinkStatus, reviewedBy: string): Promise<Result<boolean, Error>> {
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
   * Count transaction links with optional filters.
   * When accountIds is provided, counts links where source OR target transactions belong
   * to those accounts.
   *
   * @param filters - Optional filters
   * @returns Result with count
   */
  async count(filters?: { accountIds?: number[] | undefined }): Promise<Result<number, Error>> {
    try {
      const accountIds = filters?.accountIds;
      if (accountIds !== undefined && accountIds.length === 0) {
        return ok(0);
      }

      let query = this.db.selectFrom('transaction_links').select(({ fn }) => [fn.count<number>('id').as('count')]);

      if (accountIds !== undefined) {
        const transactionsSubquery = this.db
          .selectFrom('transactions')
          .select('id')
          .where('account_id', 'in', accountIds);

        query = query.where((eb) =>
          eb.or([
            eb('source_transaction_id', 'in', transactionsSubquery),
            eb('target_transaction_id', 'in', transactionsSubquery),
          ])
        );
      }

      const result = await query.executeTakeFirst();
      return ok(result?.count ?? 0);
    } catch (error) {
      this.logger.error({ error, filters }, 'Failed to count transaction links');
      return wrapError(error, 'Failed to count transaction links');
    }
  }

  async getLatestCreatedAt(): Promise<Result<Date | null, Error>> {
    try {
      const result = await this.db
        .selectFrom('transaction_links')
        .select(({ fn }) => [fn.max<string>('created_at').as('latest')])
        .executeTakeFirst();

      if (!result?.latest) {
        return ok(null);
      }

      return ok(new Date(result.latest));
    } catch (error) {
      return wrapError(error, 'Failed to get latest transaction link created_at');
    }
  }

  /**
   * Delete transaction links by account IDs
   * Deletes links where source OR target transactions belong to the specified accounts
   * Deletes WHERE source_transaction_id IN (...) OR target_transaction_id IN (...)
   *
   * @param accountIds - Account IDs to match
   * @returns Result with count of deleted links
   */
  async deleteByAccountIds(accountIds: number[]): Promise<Result<number, Error>> {
    try {
      if (accountIds.length === 0) {
        return ok(0);
      }

      const transactionsSubquery = this.db
        .selectFrom('transactions')
        .select('id')
        .where('account_id', 'in', accountIds);

      const result = await this.db
        .deleteFrom('transaction_links')
        .where((eb) =>
          eb.or([
            eb('source_transaction_id', 'in', transactionsSubquery),
            eb('target_transaction_id', 'in', transactionsSubquery),
          ])
        )
        .executeTakeFirst();

      const count = Number(result.numDeletedRows ?? 0);
      this.logger.debug({ accountIds, count }, 'Deleted transaction links by account IDs');
      return ok(count);
    } catch (error) {
      this.logger.error({ error, accountIds }, 'Failed to delete links by account IDs');
      return wrapError(error, 'Failed to delete links by account IDs');
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
      this.logger.debug({ count }, 'Deleted all transaction links');
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
  private toTransactionLink(row: TransactionLinkRow): Result<TransactionLink, Error> {
    // Parse and validate matchCriteria with schema (handles Decimal rehydration automatically)
    const matchCriteriaResult = this.parseWithSchema(row.match_criteria_json, MatchCriteriaSchema);
    if (matchCriteriaResult.isErr()) {
      return err(matchCriteriaResult.error);
    }
    if (matchCriteriaResult.value === undefined) {
      return err(new Error('match_criteria_json is required but was undefined'));
    }

    // Parse and validate metadata with schema
    const metadataResult = this.parseWithSchema(row.metadata_json, TransactionLinkMetadataSchema);
    if (metadataResult.isErr()) {
      return err(metadataResult.error);
    }

    return ok({
      id: row.id,
      sourceTransactionId: row.source_transaction_id,
      targetTransactionId: row.target_transaction_id,
      assetSymbol: row.asset,
      sourceAssetId: row.source_asset_id,
      targetAssetId: row.target_asset_id,
      sourceAmount: DecimalSchema.parse(row.source_amount),
      targetAmount: DecimalSchema.parse(row.target_amount),
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
