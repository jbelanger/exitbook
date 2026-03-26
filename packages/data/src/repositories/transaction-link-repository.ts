/* eslint-disable unicorn/no-null -- null needed by Kysely */
import {
  MatchCriteriaSchema,
  TransactionLinkMetadataSchema,
  type LinkStatus,
  type NewTransactionLink,
  type TransactionLink,
} from '@exitbook/core';
import { CurrencySchema, DecimalSchema, wrapError } from '@exitbook/foundation';
import { err, ok, type Result } from '@exitbook/foundation';
import type { Selectable } from '@exitbook/sqlite';

import type { TransactionLinksTable } from '../database-schema.js';
import type { KyselyDB } from '../database.js';
import { parseWithSchema, serializeToJson } from '../utils/db-utils.js';

import { BaseRepository } from './base-repository.js';

type TransactionLinkRow = Selectable<TransactionLinksTable>;
interface TransactionLinkFindFilters {
  profileId?: number | undefined;
  status?: LinkStatus | undefined;
}

interface TransactionLinkCountFilters {
  accountIds?: number[] | undefined;
  profileId?: number | undefined;
}

function toTransactionLink(row: TransactionLinkRow): Result<TransactionLink, Error> {
  const matchCriteriaResult = parseWithSchema(row.match_criteria_json, MatchCriteriaSchema);
  if (matchCriteriaResult.isErr()) {
    return err(matchCriteriaResult.error);
  }
  if (matchCriteriaResult.value === undefined) {
    return err(new Error('match_criteria_json is required but was undefined'));
  }

  const metadataResult = parseWithSchema(row.metadata_json, TransactionLinkMetadataSchema);
  if (metadataResult.isErr()) {
    return err(metadataResult.error);
  }

  return ok({
    id: row.id,
    sourceTransactionId: row.source_transaction_id,
    targetTransactionId: row.target_transaction_id,
    assetSymbol: CurrencySchema.parse(row.asset),
    sourceAssetId: row.source_asset_id,
    targetAssetId: row.target_asset_id,
    sourceAmount: DecimalSchema.parse(row.source_amount),
    targetAmount: DecimalSchema.parse(row.target_amount),
    sourceMovementFingerprint: row.source_movement_fingerprint,
    targetMovementFingerprint: row.target_movement_fingerprint,
    linkType: row.link_type,
    confidenceScore: DecimalSchema.parse(row.confidence_score),
    impliedFeeAmount: row.implied_fee_amount ? DecimalSchema.parse(row.implied_fee_amount) : undefined,
    matchCriteria: matchCriteriaResult.value,
    status: row.status,
    reviewedBy: row.reviewed_by ?? undefined,
    reviewedAt: row.reviewed_at ? new Date(row.reviewed_at) : undefined,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    metadata: metadataResult.value,
  });
}

export class TransactionLinkRepository extends BaseRepository {
  constructor(db: KyselyDB) {
    super(db, 'transaction-link-repository');
  }

  async create(link: NewTransactionLink): Promise<Result<number, Error>> {
    try {
      const matchCriteriaValidation = MatchCriteriaSchema.safeParse(link.matchCriteria);
      if (!matchCriteriaValidation.success) {
        return err(new Error(`Invalid match criteria: ${matchCriteriaValidation.error.message}`));
      }

      if (link.metadata !== undefined) {
        const metadataValidation = TransactionLinkMetadataSchema.safeParse(link.metadata);
        if (!metadataValidation.success) {
          return err(new Error(`Invalid link metadata: ${metadataValidation.error.message}`));
        }
      }

      const serializedMatchCriteria = serializeToJson(link.matchCriteria);
      if (serializedMatchCriteria.isErr()) {
        return err(serializedMatchCriteria.error);
      }
      if (serializedMatchCriteria.value === undefined) {
        return err(new Error('matchCriteria serialization returned undefined for required field'));
      }

      const serializedMetadata = serializeToJson(link.metadata);
      if (serializedMetadata.isErr()) {
        return err(serializedMetadata.error);
      }

      const row = await this.db
        .insertInto('transaction_links')
        .values({
          source_transaction_id: link.sourceTransactionId,
          target_transaction_id: link.targetTransactionId,
          asset: link.assetSymbol,
          source_asset_id: link.sourceAssetId,
          target_asset_id: link.targetAssetId,
          source_amount: link.sourceAmount.toFixed(),
          target_amount: link.targetAmount.toFixed(),
          implied_fee_amount: link.impliedFeeAmount?.toFixed() ?? null,
          source_movement_fingerprint: link.sourceMovementFingerprint,
          target_movement_fingerprint: link.targetMovementFingerprint,
          link_type: link.linkType,
          confidence_score: link.confidenceScore.toFixed(),
          match_criteria_json: serializedMatchCriteria.value,
          status: link.status,
          reviewed_by: link.reviewedBy ?? null,
          reviewed_at: link.reviewedAt ? link.reviewedAt.toISOString() : null,
          created_at: link.createdAt.toISOString(),
          updated_at: link.updatedAt.toISOString(),
          metadata_json: serializedMetadata.value ?? null,
        })
        .returning('id')
        .executeTakeFirstOrThrow();

      this.logger.debug({ linkId: row.id }, 'Created transaction link');
      return ok(row.id);
    } catch (error) {
      this.logger.error({ error }, 'Failed to create transaction link');
      return wrapError(error, 'Failed to create transaction link');
    }
  }

  async createBatch(links: NewTransactionLink[]): Promise<Result<number, Error>> {
    try {
      if (links.length === 0) {
        return ok(0);
      }

      for (const [i, link] of links.entries()) {
        const matchCriteriaValidation = MatchCriteriaSchema.safeParse(link.matchCriteria);
        if (!matchCriteriaValidation.success) {
          return err(
            new Error(`Invalid match criteria for link at index ${i}: ${matchCriteriaValidation.error.message}`)
          );
        }

        if (link.metadata !== undefined) {
          const metadataValidation = TransactionLinkMetadataSchema.safeParse(link.metadata);
          if (!metadataValidation.success) {
            return err(new Error(`Invalid metadata for link at index ${i}: ${metadataValidation.error.message}`));
          }
        }
      }

      const values = [];
      for (const [i, link] of links.entries()) {
        const serializedMatchCriteria = serializeToJson(link.matchCriteria);
        if (serializedMatchCriteria.isErr()) {
          return err(
            new Error(
              `Failed to serialize matchCriteria for link at index ${i}: ${serializedMatchCriteria.error.message}`
            )
          );
        }
        if (serializedMatchCriteria.value === undefined) {
          return err(new Error(`matchCriteria serialization returned undefined for required field at index ${i}`));
        }

        const serializedMetadata = serializeToJson(link.metadata);
        if (serializedMetadata.isErr()) {
          return err(
            new Error(`Failed to serialize metadata for link at index ${i}: ${serializedMetadata.error.message}`)
          );
        }

        values.push({
          source_transaction_id: link.sourceTransactionId,
          target_transaction_id: link.targetTransactionId,
          asset: link.assetSymbol,
          source_asset_id: link.sourceAssetId,
          target_asset_id: link.targetAssetId,
          source_amount: link.sourceAmount.toFixed(),
          target_amount: link.targetAmount.toFixed(),
          implied_fee_amount: link.impliedFeeAmount?.toFixed() ?? null,
          source_movement_fingerprint: link.sourceMovementFingerprint,
          target_movement_fingerprint: link.targetMovementFingerprint,
          link_type: link.linkType,
          confidence_score: link.confidenceScore.toFixed(),
          match_criteria_json: serializedMatchCriteria.value,
          status: link.status,
          reviewed_by: link.reviewedBy ?? null,
          reviewed_at: link.reviewedAt ? link.reviewedAt.toISOString() : null,
          created_at: link.createdAt.toISOString(),
          updated_at: link.updatedAt.toISOString(),
          metadata_json: serializedMetadata.value ?? null,
        });
      }

      await this.db.insertInto('transaction_links').values(values).execute();

      this.logger.info({ count: links.length }, 'Bulk created transaction links');
      return ok(links.length);
    } catch (error) {
      this.logger.error({ error }, 'Failed to bulk create transaction links');
      return wrapError(error, 'Failed to bulk create transaction links');
    }
  }

  async findById(id: number, profileId?: number): Promise<Result<TransactionLink | undefined, Error>> {
    try {
      let query = this.db.selectFrom('transaction_links').selectAll().where('id', '=', id);

      if (profileId !== undefined) {
        const scopedTransactionIds = this.buildScopedTransactionIdsQuery(profileId);
        query = query.where((eb) =>
          eb.and([
            eb('source_transaction_id', 'in', scopedTransactionIds),
            eb('target_transaction_id', 'in', scopedTransactionIds),
          ])
        );
      }

      const row = await query.executeTakeFirst();

      if (!row) {
        return ok(undefined);
      }

      const result = toTransactionLink(row);
      if (result.isErr()) {
        return err(result.error);
      }

      return ok(result.value);
    } catch (error) {
      this.logger.error({ error, id, profileId }, 'Failed to find transaction link by ID');
      return wrapError(error, 'Failed to find transaction link');
    }
  }

  async findAll(filtersOrStatus?: LinkStatus | TransactionLinkFindFilters): Promise<Result<TransactionLink[], Error>> {
    try {
      const filters = typeof filtersOrStatus === 'string' ? { status: filtersOrStatus } : (filtersOrStatus ?? {});
      let query = this.db.selectFrom('transaction_links').selectAll();

      if (filters.status) {
        query = query.where('status', '=', filters.status);
      }

      if (filters.profileId !== undefined) {
        const scopedTransactionIds = this.buildScopedTransactionIdsQuery(filters.profileId);
        query = query.where((eb) =>
          eb.and([
            eb('source_transaction_id', 'in', scopedTransactionIds),
            eb('target_transaction_id', 'in', scopedTransactionIds),
          ])
        );
      }

      query = query.orderBy('created_at', 'asc');

      const rows = await query.execute();

      const links: TransactionLink[] = [];
      for (const row of rows) {
        const result = toTransactionLink(row);
        if (result.isErr()) {
          return err(result.error);
        }
        links.push(result.value);
      }

      return ok(links);
    } catch (error) {
      this.logger.error({ error, filtersOrStatus }, 'Failed to find transaction links');
      return wrapError(error, 'Failed to find transaction links');
    }
  }

  async findByTransactionIds(transactionIds: number[], profileId?: number): Promise<Result<TransactionLink[], Error>> {
    try {
      if (transactionIds.length === 0) {
        return ok([]);
      }

      let query = this.db
        .selectFrom('transaction_links')
        .selectAll()
        .where((eb) =>
          eb.or([eb('source_transaction_id', 'in', transactionIds), eb('target_transaction_id', 'in', transactionIds)])
        );

      if (profileId !== undefined) {
        const scopedTransactionIds = this.buildScopedTransactionIdsQuery(profileId);
        query = query.where((eb) =>
          eb.and([
            eb('source_transaction_id', 'in', scopedTransactionIds),
            eb('target_transaction_id', 'in', scopedTransactionIds),
          ])
        );
      }

      const rows = await query.orderBy('created_at', 'asc').execute();

      const links: TransactionLink[] = [];
      for (const row of rows) {
        const result = toTransactionLink(row);
        if (result.isErr()) {
          return err(result.error);
        }
        links.push(result.value);
      }

      return ok(links);
    } catch (error) {
      this.logger.error({ error, profileId, transactionIds }, 'Failed to find links by transaction IDs');
      return wrapError(error, 'Failed to find links by transaction IDs');
    }
  }

  async updateStatus(id: number, status: LinkStatus, reviewedBy: string): Promise<Result<boolean, Error>> {
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

  async updateStatuses(ids: number[], status: LinkStatus, reviewedBy: string): Promise<Result<number, Error>> {
    try {
      if (ids.length === 0) {
        return ok(0);
      }

      const now = new Date().toISOString();
      const result = await this.db
        .updateTable('transaction_links')
        .set({
          status,
          reviewed_by: reviewedBy,
          reviewed_at: now,
          updated_at: now,
        })
        .where('id', 'in', ids)
        .executeTakeFirst();

      const updatedRows = Number(result.numUpdatedRows ?? 0);
      this.logger.debug({ ids, status, updatedRows }, 'Updated transaction link statuses');
      return ok(updatedRows);
    } catch (error) {
      this.logger.error({ error, ids, status }, 'Failed to update transaction link statuses');
      return wrapError(error, 'Failed to update transaction link statuses');
    }
  }

  async count(filters?: TransactionLinkCountFilters): Promise<Result<number, Error>> {
    try {
      const accountIds = filters?.accountIds;
      if (accountIds !== undefined && accountIds.length === 0) {
        return ok(0);
      }

      let query = this.db.selectFrom('transaction_links').select(({ fn }) => [fn.count<number>('id').as('count')]);

      if (accountIds !== undefined || filters?.profileId !== undefined) {
        let transactionsSubquery = this.buildScopedTransactionIdsQuery(filters?.profileId);
        if (accountIds !== undefined) {
          transactionsSubquery = transactionsSubquery.where('transactions.account_id', 'in', accountIds);
        }

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

  async findLatestCreatedAt(profileId?: number): Promise<Result<Date | null, Error>> {
    try {
      let query = this.db
        .selectFrom('transaction_links')
        .select(({ fn }) => [fn.max<string>('created_at').as('latest')]);

      if (profileId !== undefined) {
        const scopedTransactionIds = this.buildScopedTransactionIdsQuery(profileId);
        query = query.where((eb) =>
          eb.and([
            eb('source_transaction_id', 'in', scopedTransactionIds),
            eb('target_transaction_id', 'in', scopedTransactionIds),
          ])
        );
      }

      const result = await query.executeTakeFirst();

      if (!result?.latest) {
        return ok(null);
      }

      return ok(new Date(result.latest));
    } catch (error) {
      return wrapError(error, 'Failed to get latest transaction link created_at');
    }
  }

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

  private buildScopedTransactionIdsQuery(profileId?: number) {
    let query = this.db.selectFrom('transactions').select('transactions.id');

    if (profileId !== undefined) {
      query = query
        .innerJoin('accounts', 'accounts.id', 'transactions.account_id')
        .where('accounts.profile_id', '=', profileId);
    }

    return query;
  }
}
