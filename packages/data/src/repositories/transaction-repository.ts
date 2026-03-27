/* eslint-disable unicorn/no-null -- Kysely queries require null for IS NULL checks */
import { type TransactionMaterializationScope, type Transaction, type TransactionDraft } from '@exitbook/core';
import { wrapError } from '@exitbook/foundation';
import type { Result } from '@exitbook/foundation';
import { err, ok } from '@exitbook/foundation';
import type { Selectable } from '@exitbook/sqlite';

import type { TransactionsTable } from '../database-schema.js';
import type { KyselyDB } from '../database.js';
import { withControlledTransaction } from '../utils/controlled-transaction.js';
import { chunkItems, SQLITE_SAFE_IN_BATCH_SIZE } from '../utils/sqlite-batching.js';

import { BaseRepository } from './base-repository.js';
import {
  parseStoredNotes,
  projectOverrideStoreUserNote,
  rowToTransaction,
  serializeMaterializedNotes,
  toTransactionSummary,
  type MovementRow,
  type TransactionSummary,
} from './transaction-materialization-support.js';
import {
  buildInsertValues,
  buildMovementRows,
  loadAccountFingerprint,
  resolveExistingTransactionConflict,
  validatePriceDataForPersistence,
} from './transaction-persistence-support.js';

interface TransactionQueryParams {
  profileId?: number | undefined;
  platformKey?: string | undefined;
  since?: number | undefined;
  accountId?: number | undefined;
  accountIds?: number[] | undefined;
  includeExcluded?: boolean | undefined;
}

interface FullTransactionQueryParams extends TransactionQueryParams {
  projection?: 'full' | undefined;
}

interface SummaryTransactionQueryParams extends TransactionQueryParams {
  projection: 'summary';
}

interface MaterializeTransactionNoteOverridesParams extends TransactionMaterializationScope {
  notesByFingerprint: ReadonlyMap<string, string>;
}

const MOVEMENT_LOOKUP_BATCH_SIZE = SQLITE_SAFE_IN_BATCH_SIZE;

export class TransactionRepository extends BaseRepository {
  constructor(db: KyselyDB) {
    super(db, 'transaction-repository');
  }

  /**
   * Save a single transaction with its movements.
   * Transaction-agnostic: executes directly on this.db.
   * Callers that need atomicity should use DataSession.executeInTransaction().
   */
  async create(transaction: TransactionDraft, accountId: number): Promise<Result<number, Error>> {
    const accountFingerprintResult = await loadAccountFingerprint(this.db, accountId);
    if (accountFingerprintResult.isErr()) {
      return err(accountFingerprintResult.error);
    }

    const valuesResult = buildInsertValues(transaction, accountFingerprintResult.value, accountId);
    if (valuesResult.isErr()) {
      return err(valuesResult.error);
    }

    const { insertValues: values, txFingerprint } = valuesResult.value;

    try {
      const txResult = await this.db
        .insertInto('transactions')
        .values(values)
        .onConflict((oc) => oc.doNothing())
        .returning('id')
        .executeTakeFirst();

      if (!txResult) {
        const existingResult = await resolveExistingTransactionConflict(this.db, {
          blockchainTransactionHash: values.blockchain_transaction_hash ?? null,
          txFingerprint,
        });
        if (existingResult.isErr()) {
          return err(existingResult.error);
        }

        return ok(existingResult.value);
      }

      const transactionId = txResult.id;

      const movementRowsResult = buildMovementRows(transaction, transactionId, txFingerprint);
      if (movementRowsResult.isErr()) {
        return err(movementRowsResult.error);
      }

      const movementRows = movementRowsResult.value;
      if (movementRows.length > 0) {
        await this.db.insertInto('transaction_movements').values(movementRows).execute();
      }

      return ok(transactionId);
    } catch (error) {
      return wrapError(error, 'Failed to save transaction');
    }
  }

  /**
   * Save a batch of transactions with their movements.
   * Transaction-agnostic: executes directly on this.db.
   * Callers that need atomicity should use DataSession.executeInTransaction().
   */
  async createBatch(
    transactions: TransactionDraft[],
    accountId: number
  ): Promise<Result<{ duplicates: number; saved: number }, Error>> {
    if (transactions.length === 0) {
      return ok({ saved: 0, duplicates: 0 });
    }

    const createdAt = new Date().toISOString();
    const accountFingerprintResult = await loadAccountFingerprint(this.db, accountId);
    if (accountFingerprintResult.isErr()) {
      return err(accountFingerprintResult.error);
    }

    try {
      let saved = 0;
      let duplicates = 0;

      for (const [index, transaction] of transactions.entries()) {
        const valuesResult = buildInsertValues(transaction, accountFingerprintResult.value, accountId, createdAt);
        if (valuesResult.isErr()) {
          return err(new Error(`Transaction index-${index}: ${valuesResult.error.message}`));
        }
        const { insertValues: values, txFingerprint } = valuesResult.value;

        const txResult = await this.db
          .insertInto('transactions')
          .values(values)
          .onConflict((oc) => oc.doNothing())
          .returning('id')
          .executeTakeFirst();

        let transactionId: number;
        let isDuplicate = false;

        if (!txResult) {
          const existingResult = await resolveExistingTransactionConflict(this.db, {
            blockchainTransactionHash: values.blockchain_transaction_hash ?? null,
            txFingerprint,
          });
          if (existingResult.isErr()) {
            return err(existingResult.error);
          }

          transactionId = existingResult.value;
          isDuplicate = true;
          duplicates++;
        } else {
          transactionId = txResult.id;
        }

        if (!isDuplicate) {
          const movementRowsResult = buildMovementRows(transaction, transactionId, txFingerprint);
          if (movementRowsResult.isErr()) {
            return err(movementRowsResult.error);
          }

          const movementRows = movementRowsResult.value;
          if (movementRows.length > 0) {
            await this.db.insertInto('transaction_movements').values(movementRows).execute();
          }
        }

        if (!isDuplicate) {
          saved++;
        }
      }

      return ok({ saved, duplicates });
    } catch (error) {
      return wrapError(error, 'Failed to save transaction batch');
    }
  }

  findAll(filters: SummaryTransactionQueryParams): Promise<Result<TransactionSummary[], Error>>;
  findAll(filters?: FullTransactionQueryParams): Promise<Result<Transaction[], Error>>;
  async findAll(
    filters?: FullTransactionQueryParams | SummaryTransactionQueryParams
  ): Promise<Result<Transaction[] | TransactionSummary[], Error>> {
    try {
      const projection = filters?.projection ?? 'full';

      let query = this.db
        .selectFrom('transactions')
        .innerJoin('accounts', 'accounts.id', 'transactions.account_id')
        .selectAll('transactions');

      if (filters) {
        if (filters.profileId !== undefined) {
          query = query.where('accounts.profile_id', '=', filters.profileId);
        }

        if (filters.platformKey) {
          query = query.where('transactions.platform_key', '=', filters.platformKey);
        }

        if (filters.since) {
          const sinceDate = new Date(filters.since * 1000).toISOString();
          query = query.where('transactions.created_at', '>=', sinceDate as unknown as string);
        }

        if (filters.accountId !== undefined) {
          query = query.where('transactions.account_id', '=', filters.accountId);
        } else if (filters.accountIds !== undefined && filters.accountIds.length > 0) {
          query = query.where('transactions.account_id', 'in', filters.accountIds);
        }
      }

      if (!filters?.includeExcluded) {
        query = query.where('transactions.excluded_from_accounting', '=', false);
      }

      query = query.orderBy('transactions.transaction_datetime', 'asc');

      let rows: Selectable<TransactionsTable>[] = [];
      if (
        filters?.accountId === undefined &&
        filters?.accountIds !== undefined &&
        filters.accountIds.length > SQLITE_SAFE_IN_BATCH_SIZE
      ) {
        for (const accountIdBatch of chunkItems(filters.accountIds, SQLITE_SAFE_IN_BATCH_SIZE)) {
          let batchedQuery = this.db
            .selectFrom('transactions')
            .innerJoin('accounts', 'accounts.id', 'transactions.account_id')
            .selectAll('transactions');

          if (filters.profileId !== undefined) {
            batchedQuery = batchedQuery.where('accounts.profile_id', '=', filters.profileId);
          }

          if (filters.platformKey) {
            batchedQuery = batchedQuery.where('transactions.platform_key', '=', filters.platformKey);
          }

          if (filters.since) {
            const sinceDate = new Date(filters.since * 1000).toISOString();
            batchedQuery = batchedQuery.where('transactions.created_at', '>=', sinceDate as unknown as string);
          }

          batchedQuery = batchedQuery.where('transactions.account_id', 'in', accountIdBatch);

          if (!filters.includeExcluded) {
            batchedQuery = batchedQuery.where('transactions.excluded_from_accounting', '=', false);
          }

          rows.push(...(await batchedQuery.orderBy('transactions.transaction_datetime', 'asc').execute()));
        }
        rows.sort((left, right) => left.transaction_datetime.localeCompare(right.transaction_datetime));
      } else {
        rows = await query.execute();
      }

      if (projection === 'summary') {
        const summaries: TransactionSummary[] = [];
        for (const row of rows) {
          summaries.push(toTransactionSummary(row));
        }
        return ok(summaries);
      }

      const transactionIds = rows.map((r) => r.id);
      const movementsMapResult = await this.findMovementsForIds(transactionIds);
      if (movementsMapResult.isErr()) {
        return err(movementsMapResult.error);
      }
      const movementsMap = movementsMapResult.value;

      const transactions: Transaction[] = [];
      for (const row of rows) {
        const movementRows = movementsMap.get(row.id) ?? [];
        const result = rowToTransaction(row, movementRows, this.logger);
        if (result.isErr()) {
          return err(result.error);
        }
        transactions.push(result.value);
      }

      return ok(transactions);
    } catch (error) {
      return wrapError(error, 'Failed to retrieve transactions');
    }
  }

  async findById(id: number, profileId?: number): Promise<Result<Transaction | undefined, Error>> {
    try {
      let query = this.db
        .selectFrom('transactions')
        .innerJoin('accounts', 'accounts.id', 'transactions.account_id')
        .selectAll('transactions')
        .where('transactions.id', '=', id);

      if (profileId !== undefined) {
        query = query.where('accounts.profile_id', '=', profileId);
      }

      const row = await query.executeTakeFirst();

      if (!row) {
        return ok(undefined);
      }

      const movementsResult = await this.findMovementsForIds([id]);
      if (movementsResult.isErr()) {
        return err(movementsResult.error);
      }
      const movementRows = movementsResult.value.get(id) ?? [];

      const result = rowToTransaction(row, movementRows, this.logger);
      if (result.isErr()) {
        return err(result.error);
      }

      return ok(result.value);
    } catch (error) {
      return wrapError(error, 'Failed to retrieve transaction by ID');
    }
  }

  async findNeedingPrices(assetFilter?: string[], profileId?: number): Promise<Result<Transaction[], Error>> {
    try {
      let query = this.db
        .selectFrom('transactions')
        .innerJoin('accounts', 'accounts.id', 'transactions.account_id')
        .selectAll('transactions')
        .where('transactions.excluded_from_accounting', '=', false);

      if (profileId !== undefined) {
        query = query.where('accounts.profile_id', '=', profileId);
      }

      const rows = await query.execute();

      if (rows.length === 0) {
        return ok([]);
      }

      const transactionIds = rows.map((r) => r.id);
      const movementsMapResult = await this.findMovementsForIds(transactionIds);
      if (movementsMapResult.isErr()) {
        return err(movementsMapResult.error);
      }
      const movementsMap = movementsMapResult.value;

      const transactions: Transaction[] = [];
      for (const row of rows) {
        const movementRows = movementsMap.get(row.id) ?? [];
        const result = rowToTransaction(row, movementRows, this.logger);
        if (result.isErr()) {
          return err(result.error);
        }
        transactions.push(result.value);
      }

      const transactionsNeedingPrices = transactions.filter((tx) => {
        const allMovements = [...(tx.movements.inflows ?? []), ...(tx.movements.outflows ?? []), ...(tx.fees ?? [])];

        return allMovements.some((movement) => {
          if (assetFilter && assetFilter.length > 0) {
            if (!assetFilter.includes(movement.assetSymbol)) {
              return false;
            }
          }

          return !movement.priceAtTxTime || movement.priceAtTxTime.source === 'fiat-execution-tentative';
        });
      });

      return ok(transactionsNeedingPrices);
    } catch (error) {
      return wrapError(error, 'Failed to find transactions needing prices');
    }
  }

  /**
   * Update movements with enriched price data.
   * Transaction-agnostic: executes directly on this.db.
   * Callers that need atomicity should use DataSession.executeInTransaction().
   */
  async updateMovementsWithPrices(transaction: Transaction): Promise<Result<void, Error>> {
    const validationResult = validatePriceDataForPersistence(
      transaction.movements.inflows ?? [],
      transaction.movements.outflows ?? [],
      transaction.fees ?? [],
      `transaction ${transaction.id}`
    );
    if (validationResult.isErr()) {
      return err(validationResult.error);
    }

    try {
      const txExists = await this.db
        .selectFrom('transactions')
        .select(['id', 'tx_fingerprint'])
        .where('id', '=', transaction.id)
        .executeTakeFirst();

      if (!txExists) {
        return err(new Error(`Transaction ${transaction.id} not found`));
      }

      await this.db.deleteFrom('transaction_movements').where('transaction_id', '=', transaction.id).execute();

      const transactionForMovementRebuild = {
        ...transaction,
        id: undefined,
        accountId: undefined,
      } as Omit<Transaction, 'id' | 'accountId'>;

      const movementRowsResult = buildMovementRows(
        transactionForMovementRebuild,
        transaction.id,
        txExists.tx_fingerprint
      );
      if (movementRowsResult.isErr()) {
        return err(movementRowsResult.error);
      }

      const movementRows = movementRowsResult.value;
      if (movementRows.length > 0) {
        await this.db.insertInto('transaction_movements').values(movementRows).execute();
      }

      await this.db
        .updateTable('transactions')
        .set({ updated_at: new Date().toISOString() })
        .where('id', '=', transaction.id)
        .execute();

      return ok(undefined);
    } catch (error) {
      return wrapError(error, 'Failed to update movements with prices');
    }
  }

  async materializeTransactionNoteOverrides(
    params: MaterializeTransactionNoteOverridesParams
  ): Promise<Result<number, Error>> {
    if (params.accountIds !== undefined && params.accountIds.length === 0) {
      return ok(0);
    }

    if (params.transactionIds !== undefined && params.transactionIds.length === 0) {
      return ok(0);
    }

    return withControlledTransaction(
      this.db,
      this.logger,
      async (trx) => {
        const rowsById = new Map<number, { id: number; notes_json: unknown; tx_fingerprint: string }>();
        const batchedTransactionIds =
          params.transactionIds && params.transactionIds.length > SQLITE_SAFE_IN_BATCH_SIZE
            ? chunkItems(params.transactionIds, SQLITE_SAFE_IN_BATCH_SIZE)
            : [params.transactionIds];
        const batchedAccountIds =
          !params.transactionIds && params.accountIds && params.accountIds.length > SQLITE_SAFE_IN_BATCH_SIZE
            ? chunkItems(params.accountIds, SQLITE_SAFE_IN_BATCH_SIZE)
            : [params.accountIds];

        for (const transactionIdBatch of batchedTransactionIds) {
          for (const accountIdBatch of batchedAccountIds) {
            let batchedQuery = trx.selectFrom('transactions').select(['id', 'tx_fingerprint', 'notes_json']);

            if (accountIdBatch) {
              batchedQuery = batchedQuery.where('account_id', 'in', accountIdBatch);
            }

            if (transactionIdBatch) {
              batchedQuery = batchedQuery.where('id', 'in', transactionIdBatch);
            }

            const rows = await batchedQuery.execute();
            for (const row of rows) {
              rowsById.set(row.id, row);
            }
          }
        }

        const rows = [...rowsById.values()].sort((left, right) => left.id - right.id);
        let updatedCount = 0;

        for (const row of rows) {
          const existingNotesResult = parseStoredNotes(row.notes_json as string | null);
          if (existingNotesResult.isErr()) {
            return err(
              new Error(`Failed to parse notes for transaction ${row.id}: ${existingNotesResult.error.message}`)
            );
          }

          const nextNotes = projectOverrideStoreUserNote(
            existingNotesResult.value,
            params.notesByFingerprint.get(row.tx_fingerprint)
          );

          if (JSON.stringify(existingNotesResult.value ?? []) === JSON.stringify(nextNotes ?? [])) {
            continue;
          }

          const notesJsonResult = serializeMaterializedNotes(nextNotes);
          if (notesJsonResult.isErr()) {
            return err(
              new Error(`Failed to serialize notes for transaction ${row.id}: ${notesJsonResult.error.message}`)
            );
          }

          await trx
            .updateTable('transactions')
            .set({
              notes_json: notesJsonResult.value ?? null,
              updated_at: new Date().toISOString(),
            })
            .where('id', '=', row.id)
            .execute();

          updatedCount++;
        }

        return ok(updatedCount);
      },
      'Failed to materialize transaction note overrides'
    );
  }

  async count(filters?: TransactionQueryParams): Promise<Result<number, Error>> {
    try {
      let query = this.db
        .selectFrom('transactions')
        .innerJoin('accounts', 'accounts.id', 'transactions.account_id')
        .select(({ fn }) => [fn.count<number>('transactions.id').as('count')]);

      if (filters) {
        if (filters.profileId !== undefined) {
          query = query.where('accounts.profile_id', '=', filters.profileId);
        }

        if (filters.platformKey) {
          query = query.where('transactions.platform_key', '=', filters.platformKey);
        }

        if (filters.since) {
          const sinceDate = new Date(filters.since * 1000).toISOString();
          query = query.where('transactions.created_at', '>=', sinceDate as unknown as string);
        }

        if (filters.accountId !== undefined) {
          query = query.where('transactions.account_id', '=', filters.accountId);
        } else if (filters.accountIds !== undefined && filters.accountIds.length > 0) {
          if (filters.accountIds.length > SQLITE_SAFE_IN_BATCH_SIZE) {
            let totalCount = 0;
            for (const accountIdBatch of chunkItems(filters.accountIds, SQLITE_SAFE_IN_BATCH_SIZE)) {
              let batchedQuery = this.db
                .selectFrom('transactions')
                .innerJoin('accounts', 'accounts.id', 'transactions.account_id')
                .select(({ fn }) => [fn.count<number>('transactions.id').as('count')]);

              if (filters.profileId !== undefined) {
                batchedQuery = batchedQuery.where('accounts.profile_id', '=', filters.profileId);
              }

              if (filters.platformKey) {
                batchedQuery = batchedQuery.where('transactions.platform_key', '=', filters.platformKey);
              }

              if (filters.since) {
                const sinceDate = new Date(filters.since * 1000).toISOString();
                batchedQuery = batchedQuery.where('transactions.created_at', '>=', sinceDate as unknown as string);
              }

              batchedQuery = batchedQuery.where('transactions.account_id', 'in', accountIdBatch);

              if (!filters.includeExcluded) {
                batchedQuery = batchedQuery.where('transactions.excluded_from_accounting', '=', false);
              }

              const result = await batchedQuery.executeTakeFirst();
              totalCount += result?.count ?? 0;
            }

            return ok(totalCount);
          }

          query = query.where('transactions.account_id', 'in', filters.accountIds);
        } else if (filters.accountIds !== undefined && filters.accountIds.length === 0) {
          return ok(0);
        }

        if (!filters.includeExcluded) {
          query = query.where('transactions.excluded_from_accounting', '=', false);
        }
      } else {
        query = query.where('transactions.excluded_from_accounting', '=', false);
      }

      const result = await query.executeTakeFirst();
      return ok(result?.count ?? 0);
    } catch (error) {
      return wrapError(error, 'Failed to count transactions');
    }
  }

  async deleteByAccountIds(accountIds: number[]): Promise<Result<number, Error>> {
    try {
      if (accountIds.length === 0) {
        return ok(0);
      }
      let deletedCount = 0;
      for (const accountIdBatch of chunkItems(accountIds, SQLITE_SAFE_IN_BATCH_SIZE)) {
        const result = await this.db
          .deleteFrom('transactions')
          .where('account_id', 'in', accountIdBatch)
          .executeTakeFirst();
        deletedCount += Number(result.numDeletedRows);
      }
      return ok(deletedCount);
    } catch (error) {
      return wrapError(error, 'Failed to delete transactions by account IDs');
    }
  }

  async findLatestCreatedAt(profileId?: number): Promise<Result<Date | null, Error>> {
    try {
      let query = this.db
        .selectFrom('transactions')
        .innerJoin('accounts', 'accounts.id', 'transactions.account_id')
        .select(({ fn }) => [fn.max<string>('transactions.created_at').as('latest')]);

      if (profileId !== undefined) {
        query = query.where('accounts.profile_id', '=', profileId);
      }

      const result = await query.executeTakeFirst();

      if (!result?.latest) {
        return ok(null);
      }

      return ok(new Date(result.latest));
    } catch (error) {
      return wrapError(error, 'Failed to get latest transaction created_at');
    }
  }

  async deleteAll(): Promise<Result<number, Error>> {
    try {
      const result = await this.db.deleteFrom('transactions').executeTakeFirst();
      return ok(Number(result.numDeletedRows));
    } catch (error) {
      return wrapError(error, 'Failed to delete all transactions');
    }
  }

  private async findMovementsForIds(transactionIds: number[]): Promise<Result<Map<number, MovementRow[]>, Error>> {
    if (transactionIds.length === 0) {
      return ok(new Map());
    }

    try {
      const map = new Map<number, MovementRow[]>();

      for (const transactionIdBatch of chunkItems(transactionIds, MOVEMENT_LOOKUP_BATCH_SIZE)) {
        const rows = await this.db
          .selectFrom('transaction_movements')
          .selectAll()
          .where('transaction_id', 'in', transactionIdBatch)
          .orderBy('transaction_id', 'asc')
          .execute();

        for (const row of rows) {
          const existing = map.get(row.transaction_id);
          if (existing) {
            existing.push(row);
          } else {
            map.set(row.transaction_id, [row]);
          }
        }
      }

      return ok(map);
    } catch (error) {
      return wrapError(error, 'Failed to load movements for transactions');
    }
  }
}
